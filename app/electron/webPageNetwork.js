const dns = require("node:dns/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");
const {once} = require("node:events");
const {Readable} = require("node:stream");
const zlib = require("node:zlib");

const blockedAddresses = new net.BlockList();
for (const [address, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) {
    blockedAddresses.addSubnet(address, prefix);
}
blockedAddresses.addSubnet("2001::", 32, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");
blockedAddresses.addSubnet("2002::", 16, "ipv6");
const publicIPv6 = new net.BlockList();
publicIPv6.addSubnet("2000::", 3, "ipv6");

const isPublicAddress = address => {
    const family = net.isIP(address);
    return family === 4 ? !blockedAddresses.check(address) :
        family === 6 && publicIPv6.check(address, "ipv6") && !blockedAddresses.check(address, "ipv6");
};

const parsePageURL = rawURL => {
    const url = new URL(rawURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Only HTTP and HTTPS URLs without credentials are allowed");
    }
    return url;
};

const resolvePageTarget = async (url, lookup = dns.lookup) => {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = net.isIP(host) ? [{address: host}] : await lookup(host, {all: true, verbatim: true});
    if (!addresses.length || addresses.some(({address}) => !isPublicAddress(address))) {
        throw new Error("Access to private/internal IP is prohibited");
    }
    return {host, address: addresses[0].address, port: Number(url.port || (url.protocol === "https:" ? 443 : 80))};
};

const connectSocket = async (options, secure, signal) => {
    const socket = secure ? tls.connect({...options, signal}) : net.connect({...options, signal});
    await once(socket, secure ? "secureConnect" : "connect", {signal});
    return socket;
};

const readExactly = async (socket, length, signal) => {
    let bytes;
    while ((bytes = socket.read(length)) === null) {
        if (socket.destroyed || socket.readableEnded) {
            throw new Error("Proxy closed the connection");
        }
        await once(socket, "readable", {signal});
    }
    return bytes;
};

const connectHTTPProxy = (proxy, target, signal) => new Promise((resolve, reject) => {
    const authority = net.isIP(target.address) === 6 ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`;
    const headers = {Host: authority};
    if (proxy.username || proxy.password) {
        headers["Proxy-Authorization"] = "Basic " + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64");
    }
    const request = (proxy.protocol === "https:" ? https : http).request(proxy, {
        method: "CONNECT", path: authority, headers, signal, agent: false,
    });
    request.once("error", reject);
    request.once("connect", (response, socket, head) => {
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

const connectSOCKSProxy = async (proxy, target, signal) => {
    const socket = await connectSocket({host: proxy.hostname, port: Number(proxy.port || 1080)}, false, signal);
    try {
        socket.write(Buffer.from([5, 1, 0]));
        const greeting = await readExactly(socket, 2, signal);
        if (greeting[0] !== 5 || greeting[1] !== 0) {
            throw new Error("SOCKS proxy requires unsupported authentication");
        }
        // 向代理发送已校验的数字 IP，禁止代理重新解析目标主机名。
        let address;
        if (net.isIP(target.address) === 4) {
            address = Buffer.from([1, ...target.address.split(".").map(Number)]);
        } else {
            const halves = target.address.split("::").map(part => part ? part.split(":") : []);
            const groups = halves.length === 1 ? halves[0] :
                [...halves[0], ...Array(8 - halves[0].length - halves[1].length).fill("0"), ...halves[1]];
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

const connectPageTarget = async (target, proxyResult, signal) => {
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
const readPageBody = async (response, signal) => {
    let stream = response;
    const encoding = response.headers["content-encoding"]?.toLowerCase();
    if (encoding && encoding !== "identity") {
        const decoder = encoding === "gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() :
            encoding === "br" ? zlib.createBrotliDecompress() : undefined;
        if (!decoder) {
            throw new Error("Unsupported page content encoding");
        }
        stream = response.compose(decoder, {signal});
    }
    const chunks = [];
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

const requestPage = async (request, {resolveProxy, signal, lookup}) => {
    const url = parsePageURL(request.url);
    const target = await resolvePageTarget(url, lookup);
    signal.throwIfAborted();
    const proxy = await resolveProxy(url.href);
    signal.throwIfAborted();
    const secure = url.protocol === "https:";
    const agent = secure ? new https.Agent({keepAlive: false}) : new http.Agent({keepAlive: false});
    agent.createConnection = (_options, callback) => {
        connectPageTarget(target, proxy, signal).then(async socket => {
            if (signal.aborted) {
                socket.destroy();
                throw signal.reason;
            }
            if (secure) {
                const secureSocket = tls.connect({socket, host: target.host, servername: net.isIP(target.host) ? undefined : target.host,
                    rejectUnauthorized: true, signal});
                await once(secureSocket, "secureConnect", {signal});
                return secureSocket;
            }
            return socket;
        }).then(socket => callback(null, socket), error => callback(error));
    };
    try {
        let body;
        if (request.body) {
            const chunks = [];
            let length = 0;
            const stream = Readable.fromWeb(request.body, {signal});
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
        const response = await new Promise((resolve, reject) => {
            const outgoing = (secure ? https : http).request(url, {method: request.method, headers, agent, signal}, resolve);
            outgoing.once("error", reject);
            outgoing.end(body);
        });
        const data = await readPageBody(response, signal);
        const responseHeaders = new Headers();
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
            const key = response.rawHeaders[index];
            if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
                responseHeaders.append(key, response.rawHeaders[index + 1]);
            }
        }
        return new Response([101, 204, 205, 304].includes(response.statusCode) || request.method === "HEAD" ? null : data,
            {status: response.statusCode, headers: responseHeaders});
    } finally {
        agent.destroy();
    }
};

module.exports = {isPublicAddress, parsePageURL, resolvePageTarget, requestPage, connectPageTarget};
