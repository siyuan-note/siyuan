import * as dns from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import * as tls from "node:tls";
import {once} from "node:events";
import {Readable} from "node:stream";
import * as zlib from "node:zlib";
import type {Socket} from "node:net";

// 页面抓取只接受公开网络的 IPv4/IPv6 目标，代理握手使用已校验的数字地址。
type PageTarget = {host: string; address: string; port: number};

type PageLookup = (hostname: string, options: {all: true; verbatim: true}) => Promise<{address: string}[]>;

// Node 的 IncomingHttpHeaders 把单值头声明为 string | string[]，而实际用到的头都是单值。
type PageBodySource = Readable & {
    headers: Record<string, string | undefined>;
    rawHeaders: string[];
    compose: (decoder: unknown, options: {signal?: AbortSignal}) => Readable;
};

const blockedAddresses = new net.BlockList();
for (const [address, prefix] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as [string, number][]) {
    blockedAddresses.addSubnet(address, prefix);
}
blockedAddresses.addSubnet("2001::", 32, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
blockedAddresses.addSubnet("2002::", 16, "ipv6");
const publicIPv6 = new net.BlockList();
publicIPv6.addSubnet("2000::", 3, "ipv6");

const isPublicAddress = (address: string): boolean => {
    const family = net.isIP(address);
    return family === 4 ? !blockedAddresses.check(address) :
        family === 6 && publicIPv6.check(address, "ipv6") && !blockedAddresses.check(address, "ipv6");
};

const parsePageURL = (rawURL: string): URL => {
    const url = new URL(rawURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Only HTTP and HTTPS URLs without credentials are allowed");
    }
    return url;
};

const resolvePageTarget = async (url: URL, lookup: PageLookup = dns.lookup): Promise<PageTarget> => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host) ? [{address: host}] : await lookup(host, {all: true, verbatim: true});
    if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) {
        throw new Error("Access to private/internal IP is prohibited");
    }
    return {host, address: addresses[0].address, port: Number(url.port || (url.protocol === "https:" ? 443 : 80))};
};

// tls.connect 运行时把 signal 透传给 TLSSocket，但 @types/node 的 ConnectionOptions 未声明该选项。
type TLSConnectOptions = tls.ConnectionOptions & {signal?: AbortSignal};

const connectSocket = async (options: {host: string; port: number}, secure: boolean,
    signal?: AbortSignal): Promise<Socket> => {
    const connectOptions: TLSConnectOptions = {...options, signal};
    const socket = secure ? tls.connect(connectOptions) : net.connect({...options, signal});
    await once(socket, secure ? "secureConnect" : "connect", {signal});
    return socket;
};

const readExactly = async (socket: Socket, length: number, signal?: AbortSignal): Promise<Buffer> => {
    let bytes: Buffer;
    while ((bytes = socket.read(length)) === null) {
        if (socket.destroyed || socket.readableEnded) {
            throw new Error("Proxy closed the connection");
        }
        await once(socket, "readable", {signal});
    }
    return bytes;
};

const connectHTTPProxy = (proxy: URL, target: PageTarget,
    signal?: AbortSignal): Promise<Socket> => new Promise<Socket>((resolve, reject) => {
    const authority = net.isIP(target.address) === 6 ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`;
    const headers: Record<string, string> = {Host: authority};
    if (proxy.username || proxy.password) {
        headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");
    }
    const request = (proxy.protocol === "https:" ? https : http).request(proxy, {
        method: "CONNECT", path: authority, headers, signal, agent: false,
    });
    request.once("error", reject);
    request.once("connect", (response: {statusCode: number}, socket: Socket, head: Buffer) => {
        if (response.statusCode !== 200) {
            socket.destroy();
            reject(new Error(`Proxy CONNECT failed: HTTP ${response.statusCode}`));
            return;
        }
        if (head.length) {
            socket.unshift(head);
        }
        resolve(socket);
    });
    request.end();
});

const connectSOCKSProxy = async (proxy: URL, target: PageTarget, signal?: AbortSignal): Promise<Socket> => {
    const socket = await connectSocket({host: proxy.hostname, port: Number(proxy.port || 1080)}, false, signal);
    try {
        socket.write(Buffer.from([5, 1, 0]));
        const greeting = await readExactly(socket, 2, signal);
        if (greeting[0] !== 5 || greeting[1] !== 0) {
            throw new Error("SOCKS proxy requires unsupported authentication");
        }
        // 向代理发送已校验的数字 IP，禁止代理重新解析目标主机名。
        let address: Buffer;
        if (net.isIP(target.address) === 4) {
            address = Buffer.from([1, ...target.address.split(".").map(Number)]);
        } else {
            const halves = target.address.split("::").map(part => part ? part.split(":") : []);
            const groups = halves.length === 1 ? halves[0] :
                [...halves[0], ...new Array<string>(8 - halves[0].length - halves[1].length).fill("0"), ...halves[1]];
            address = Buffer.alloc(17);
            address[0] = 4;
            groups.forEach((group, index) => address.writeUInt16BE(parseInt(group, 16), 1 + index * 2));
        }
        const port = Buffer.alloc(2);
        port.writeUInt16BE(target.port);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, port]));
        const response = await readExactly(socket, 4, signal);
        if (response[0] !== 5 || response[1] !== 0) {
            throw new Error("SOCKS proxy connection failed");
        }
        const addressLength = response[3] === 1 ? 4 : response[3] === 4 ? 16 :
            response[3] === 3 ? (await readExactly(socket, 1, signal))[0] : 0;
        if (!addressLength) {
            throw new Error("Invalid SOCKS proxy response");
        }
        await readExactly(socket, addressLength + 2, signal);
        return socket;
    } catch (error) {
        socket.destroy();
        throw error;
    }
};

const connectPageTarget = async (target: PageTarget, proxyResult: string,
    signal?: AbortSignal): Promise<Socket> => {
    // 遵循当前窗口解析出的首选代理；代理失败时不静默改用其他出口。
    const entry = proxyResult.split(";")[0].trim();
    if (entry === "DIRECT") {
        return connectSocket({host: target.address, port: target.port}, false, signal);
    }
    const match = /^(PROXY|HTTPS|SOCKS5)\s+(.+)$/i.exec(entry);
    if (!match) {
        throw new Error("Unsupported browser proxy configuration");
    }
    const type = match[1].toUpperCase();
    const proxy = new URL(`${type === "HTTPS" ? "https" : type.startsWith("SOCKS") ? "socks5" : "http"}://${match[2]}`);
    return type.startsWith("SOCKS") ? connectSOCKSProxy(proxy, target, signal) : connectHTTPProxy(proxy, target, signal);
};

const maxPageBytes = 5 * 1024 * 1024;
// 代理可能忽略 `accept-encoding: identity`，因此仍按响应头解包。
const readPageBody = async (response: PageBodySource, signal?: AbortSignal): Promise<Buffer> => {
    let stream: Readable = response;
    const encoding = response.headers["content-encoding"]?.toLowerCase();
    if (encoding && encoding !== "identity") {
        const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() :
            encoding === "br" ? zlib.createBrotliDecompress() : undefined;
        if (!decoder) {
            throw new Error("Unsupported page content encoding");
        }
        stream = response.compose(decoder, {signal});
    }
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of stream) {
        length += chunk.length;
        if (length > maxPageBytes) {
            stream.destroy();
            throw new Error("Page response too large");
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};

const requestPage = async (request: {
    url: string;
    method: string;
    headers: Iterable<[string, string]>;
    body?: ReadableStream | null;
},
    {resolveProxy, signal, lookup}: {
        resolveProxy: (url: string) => Promise<string>;
        signal: AbortSignal;
        lookup?: PageLookup;
    }): Promise<Response> => {
    const url = parsePageURL(request.url);
    const target = await resolvePageTarget(url, lookup);
    signal.throwIfAborted();
    const proxy = await resolveProxy(url.href);
    signal.throwIfAborted();
    const secure = url.protocol === "https:";
    const agent = secure ? new https.Agent({keepAlive: false}) : new http.Agent({keepAlive: false});
    // Agent 声明的 createConnection 要同步返回 socket，但 Node 同样支持返回 undefined 并在回调里给出连接。
    const createConnection = (_options: unknown,
        callback: (error: Error | null, socket?: Socket) => void): void => {
        connectPageTarget(target, proxy, signal).then(async socket => {
            if (signal.aborted) {
                socket.destroy();
                throw signal.reason;
            }
            if (secure) {
                const connectOptions: TLSConnectOptions = {
                    socket, host: target.host, signal, rejectUnauthorized: true,
                    servername: net.isIP(target.host) ? undefined : target.host,
                };
                const secureSocket = tls.connect(connectOptions);
                await once(secureSocket, "secureConnect", {signal});
                return secureSocket;
            }
            return socket;
        }).then(socket => callback(null, socket), error => callback(error));
    };
    agent.createConnection = createConnection as unknown as typeof agent.createConnection;
    try {
        let body: Buffer | undefined;
        if (request.body) {
            const chunks: Buffer[] = [];
            let length = 0;
            // DOM 与 node:stream/web 各有一套 ReadableStream 声明，运行时是同一个对象。
            const stream = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0], {signal});
            for await (const chunk of stream) {
                length += chunk.length;
                if (length > maxPageBytes) {
                    stream.destroy();
                    throw new Error("Page request body too large");
                }
                chunks.push(chunk);
            }
            body = Buffer.concat(chunks);
        }
        const headers = Object.fromEntries(request.headers);
        headers.host = url.host;
        headers["accept-encoding"] = "identity";
        delete headers["proxy-authorization"];
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
            const outgoing = (secure ? https : http).request(url, {method: request.method, headers, agent, signal}, resolve);
            outgoing.once("error", reject);
            outgoing.end(body);
        });
        // IncomingMessage 同时是 Readable，并带 compose；这里只为把头部声明收窄成单值。
        const data = await readPageBody(response as unknown as PageBodySource, signal);
        const responseHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
            const key = response.rawHeaders[index];
            if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
                responseHeaders.append(key, response.rawHeaders[index + 1]);
            }
        }
        // 未给出状态码时按 200 处理，与 Response 省略 status 时的默认值一致。
        const statusCode = response.statusCode ?? 200;
        return new Response([101, 204, 205, 304].includes(statusCode) || request.method === "HEAD"
            ? null : data as unknown as BodyInit,
        {status: statusCode, headers: responseHeaders});
    } finally {
        agent.destroy();
    }
};

export {isPublicAddress, parsePageURL, resolvePageTarget, requestPage, connectPageTarget};
export type {PageLookup};
