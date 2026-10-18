const {test} = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const {once} = require("node:events");
const {gzipSync} = require("node:zlib");
const {isPublicAddress, parsePageURL, resolvePageTarget, requestPage, connectPageTarget} = require("./webPageNetwork");

test("rendered page URLs and all resolved addresses must be public", async () => {
    for (const url of ["file:///test", "data:text/html,hello", "javascript:alert(1)", "https://user:pass@example.com/"]) {
        assert.throws(() => parsePageURL(url));
    }
    for (const address of ["0.0.0.0", "127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "100.64.0.1", "169.254.169.254",
        "224.1.1.1", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001::80ff:fffe"]) {
        assert.equal(isPublicAddress(address), false, address);
        await assert.rejects(resolvePageTarget(parsePageURL(`https://${address.includes(":") ? `[${address}]` : address}/`)), /private/);
    }
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
        assert.equal(isPublicAddress(address), true, address);
    }
    await assert.rejects(resolvePageTarget(parsePageURL("https://public.test/"), async () =>
        [{address: "8.8.8.8"}, {address: "127.0.0.1"}]), /private/);
});

const startProxy = async (t, handler) => {
    const targets = [];
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const proxy = http.createServer();
    const sockets = new Set();
    proxy.on("connection", socket => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    });
    proxy.on("connect", (request, socket, head) => {
        targets.push(request.url);
        const upstream = net.connect(server.address().port, "127.0.0.1", () => {
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head.length) {
                upstream.write(head);
            }
            socket.pipe(upstream).pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.destroy());
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    t.after(() => {
        for (const socket of sockets) {
            socket.destroy();
        }
        server.closeAllConnections();
        server.close();
        proxy.close();
    });
    return {targets, resolveProxy: async () => `PROXY 127.0.0.1:${proxy.address().port}`};
};

test("page transport pins DNS through the configured proxy and preserves HTTP semantics", async t => {
    let seen;
    const proxy = await startProxy(t, (request, response) => {
        seen = {host: request.headers.host, path: request.url};
        response.writeHead(200, {"Content-Type": "text/html", "Content-Encoding": "gzip", "Set-Cookie": "isolated=1"});
        response.end(gzipSync("<main>Rendered source</main>"));
    });
    let lookups = 0;
    const response = await requestPage(new Request("http://public.test/path?q=1"), {...proxy,
        signal: AbortSignal.timeout(3000), lookup: async () => {
            lookups++;
            return [{address: lookups === 1 ? "93.184.216.34" : "127.0.0.1"}];
        }});
    assert.equal(await response.text(), "<main>Rendered source</main>");
    assert.deepEqual(seen, {host: "public.test", path: "/path?q=1"});
    assert.equal(lookups, 1);
    assert.deepEqual(proxy.targets, ["93.184.216.34:80"]);
    assert.equal(response.headers.get("content-encoding"), null);
    assert.equal(response.headers.get("set-cookie"), "isolated=1");
});

test("page transport bounds response size, preserves redirects and aborts stalled requests", async t => {
    const proxy = await startProxy(t, (request, response) => {
        if (request.url === "/large") {
            response.end("a".repeat(5 * 1024 * 1024 + 1));
        } else if (request.url === "/redirect") {
            response.writeHead(302, {Location: "http://127.0.0.1/"});
            response.end();
        }
    });
    const options = {...proxy, signal: AbortSignal.timeout(3000), lookup: async () => [{address: "93.184.216.34"}]};
    await assert.rejects(requestPage(new Request("http://public.test/large"), options), /too large/);
    const redirect = await requestPage(new Request("http://public.test/redirect"), options);
    assert.equal(redirect.status, 302);
    await assert.rejects(requestPage(new Request(redirect.headers.get("location")), options), /private/);
    await assert.rejects(requestPage(new Request("http://public.test/stall"), {...options, signal: AbortSignal.timeout(100)}), /abort/i);
    assert.equal(proxy.targets.length, 3);
});

test("SOCKS page connections send numeric addresses without another DNS lookup", async t => {
    await assert.rejects(connectPageTarget({address: "8.8.8.8", port: 443}, "SOCKS 127.0.0.1:1", AbortSignal.timeout(100)), /Unsupported/);
    for (const [address, encoded] of [["8.8.8.8", "050100010808080801bb"],
        ["2606:4700:4700::1111", "050100042606470047000000000000000000111101bb"]]) {
        const server = net.createServer(socket => {
            socket.once("data", greeting => {
                assert.deepEqual(greeting, Buffer.from([5, 1, 0]));
                socket.write(Buffer.from([5, 0]));
                socket.once("data", request => {
                    assert.equal(request.toString("hex"), encoded);
                    socket.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
                });
            });
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        t.after(() => server.close());
        const socket = await connectPageTarget({address, port: 443}, `SOCKS5 127.0.0.1:${server.address().port}`, AbortSignal.timeout(3000));
        socket.destroy();
    }
});
