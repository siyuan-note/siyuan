const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("rendered fetch IPC accepts only a trusted main frame and uses its proxy", async () => {
        const {installWebPageFetchIPC} = require("./webPageFetch");
        let handler;
        let calls = 0;
        const timeouts = [];
        const frame = {};
        const sender = {mainFrame: frame, session: {resolveProxy: async url => "PROXY " + url}};
        installWebPageFetchIPC({handle: (name, callback) => {
            assert.equal(name, "siyuan-web-page-fetch");
            handler = callback;
        }}, async (url, resolveProxy, caller, timeoutMs) => {
            calls++;
            timeouts.push(timeoutMs);
            assert.equal(caller, sender);
            return resolveProxy(url);
        }, candidate => candidate === sender);
        for (const [event, data] of [[{sender: {}, senderFrame: frame}, {url: "https://example.com"}],
            [{sender, senderFrame: {}}, {url: "https://example.com"}], [{sender, senderFrame: frame}, {}],
            [{sender, senderFrame: frame}, {url: "a".repeat(8193)}]]) {
            await assert.rejects(handler(event, data), /unavailable/);
        }
        assert.equal(calls, 0);
        assert.equal(await handler({sender, senderFrame: frame}, {url: "https://example.com"}), "PROXY https://example.com");
        assert.equal(calls, 1);
        for (const timeout of [-1, 0, 1, 60, 600, 999, "60", null]) {
            await handler({sender, senderFrame: frame}, {url: "https://example.com", timeout});
        }
        assert.deepEqual(timeouts, [undefined, undefined, undefined, 1000, 60000, 600000, 600000, undefined, undefined]);
    });
    test("rendered page fetch executes JavaScript with isolated sessions and bounded failures", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-web-fetch-test-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, timeout: 60000, windowsHide: true,
            });
            assert.match(stdout, /Rendered page fetch passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        }
    });
    test("rendered fetch drops subresources beyond total and concurrent budgets without dropping content", async () => {
        const {EventEmitter} = require("node:events");
        const {createWebPageFetcher} = require("./webPageFetch");
        for (const concurrent of [false, true]) {
            let handle;
            let lookups = 0;
            const fetchSession = Object.assign(new EventEmitter(), {
                setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {},
                protocol: {handle: (_scheme, callback) => handle = callback, unhandle() {}},
                webRequest: {onBeforeRequest() {}}, closeAllConnections: async () => {}, clearStorageData: async () => {},
            });
            class TestWindow {
                webContents = Object.assign(new EventEmitter(), {
                    getUserAgent: () => "test", setUserAgent() {}, setWebRTCIPHandlingPolicy() {}, setWindowOpenHandler() {},
                    debugger: {attach() {}, sendCommand: async () => {}},
                    executeJavaScriptInIsolatedWorld: async () => ({html: "<main>Usable content</main>", text: "Usable content ".repeat(10)}),
                });
                async loadURL(url) {
                    if (url === "about:blank") return;
                    const request = () => handle(new Request("http://resource.test/"));
                    if (concurrent) {
                        await Promise.all(Array.from({length: 140}, request));
                    } else {
                        for (let index = 0; index < 1030; index++) {
                            await request();
                        }
                    }
                    this.webContents.emit("did-finish-load");
                }
                isDestroyed() { return false; }
                destroy() {}
            }
            const fetchPage = createWebPageFetcher({BrowserWindow: TestWindow, session: {fromPartition: () => fetchSession},
                lookup: async () => { lookups++; throw new Error("Unavailable resource"); }, idleMs: 0, timeoutMs: 2000});
            const result = await fetchPage("http://page.test/");
            assert.match(result.text, /Usable content/);
            assert.equal(lookups, concurrent ? 128 : 1024);
        }
    });
} else {
    const {app, BrowserWindow, session} = require("electron");
    const http = require("node:http");
    const net = require("node:net");
    const {once} = require("node:events");
    const {createWebPageFetcher} = require("./webPageFetch");
    require("../stage/protyle/js/lute/lute.min.js");
    const {Lute} = globalThis;
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.on("window-all-closed", () => {});
    app.whenReady().then(async () => {
        const requests = [];
        const targets = [];
        const windows = [];
        const server = http.createServer((request, response) => {
            requests.push({url: request.url, headers: request.headers});
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Set-Cookie", "isolated=1");
            if (request.url === "/dynamic") {
                response.end(`<main><h1>Heading</h1><div id="content"></div></main><script>
                    setTimeout(async () => { document.getElementById("content").innerHTML = await (await fetch("/body")).text(); }, 50);
                </script>`);
            } else if (request.url === "/body") {
                setTimeout(() => response.end(`<p>JavaScript rendered content ${"dynamic text ".repeat(12)}</p><pre><code><span>const</span> value = <span>42</span>;</code></pre><a href="/next">Next page</a><p>${typeof require} fixture</p>`), 150);
            } else if (request.url === "/delayed") {
                setTimeout(() => response.end(`<main>${"Delayed content ".repeat(12)}</main>`), 400);
            } else if (request.url === "/environment") {
                response.end(`<main><script>alert("Hidden page dialog"); document.write("Node: " + typeof require + " " + typeof process +
                    " Network: " + ["RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport", "WebSocket"].map(name => typeof window[name]).join(" "));
                    const frame = document.createElement("iframe"); document.body.appendChild(frame);
                    document.write(" Frame: " + typeof frame.contentWindow.RTCPeerConnection);
                    </script><p>${"visible text ".repeat(12)}</p></main>`);
            } else if (request.url === "/markdown") {
                response.setHeader("Content-Type", "text/markdown");
                response.end("# Negotiated Markdown\n\nOriginal **text**");
            } else if (request.url === "/redirect") {
                response.writeHead(302, {Location: "http://public.test/markdown"});
                response.end();
            } else if (request.url === "/workers") {
                response.end(`<main id=content></main><script>
                    try { const worker = new Worker("/worker.js"); worker.onerror = () => { document.getElementById("content").textContent = "Worker blocked"; }; }
                    catch { document.getElementById("content").textContent = "Worker blocked"; }
                    </script>`);
            } else if (request.url === "/download") {
                response.setHeader("Content-Disposition", "attachment; filename=test.bin");
                response.setHeader("Content-Type", "application/octet-stream");
                response.end("download");
            } else if (request.url === "/private") {
                response.writeHead(302, {Location: "http://127.0.0.1/"});
                response.end();
            } else if (request.url === "/private-resource") {
                response.end(`<main>${"text ".repeat(30)}</main><script>fetch("http://127.0.0.1/private")</script>`);
            } else if (request.url === "/failed-resources") {
                response.end(`<main>${"Usable page content ".repeat(12)}</main><script>
                    fetch("http://missing.test/resource").catch(() => {});
                    fetch("/private").catch(() => {});
                    fetch("/download").catch(() => {});
                    fetch("file:///unavailable").catch(() => {});
                </script>`);
            } else if (request.url === "/many-resources") {
                response.end(`<main>${"Request-heavy page content ".repeat(12)}</main><script>
                    for (let index = 0; index < 1100; index++) {
                        fetch("/resource?index=" + index).catch(() => {});
                    }
                </script>`);
            } else if (request.url === "/empty") {
                response.end("<div id=app></div><script>window.empty = true</script>");
            } else if (request.url === "/status") {
                response.writeHead(404);
                response.end("missing");
            } else if (request.url !== "/stall") {
                response.end(`<main><h1>Static page</h1><p>${"public content ".repeat(12)}</p></main>`);
            }
        });
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const sockets = new Set();
        const proxy = http.createServer();
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
        const fetchPage = createWebPageFetcher({BrowserWindow: function (options) {
            windows.push(options);
            return new BrowserWindow(options);
        }, session, lookup: async host => {
            if (host === "missing.test") {
                throw new Error("DNS lookup failed");
            }
            return [{address: "93.184.216.34"}];
        }, timeoutMs: 2500, postLoadMs: 700, idleMs: 200});
        const resolveProxy = async () => `PROXY 127.0.0.1:${proxy.address().port}`;
        try {
            await session.defaultSession.cookies.set({url: "http://public.test", name: "mainSecret", value: "private"});
            const dynamic = await fetchPage("http://public.test/dynamic", resolveProxy);
            assert.match(dynamic.text, /JavaScript rendered content/);
            assert.match(dynamic.html, /http:\/\/public.test\/next/);
            const markdown = Lute.New().HTML2Md(dynamic.html);
            assert.match(markdown, /# Heading/);
            assert.match(markdown, /const value = 42;/);
            assert.doesNotMatch(markdown, /setTimeout|<script/);
            await assert.rejects(fetchPage("http://public.test/delayed", resolveProxy, undefined, 100), /timed out/);
            assert.match((await fetchPage("http://public.test/delayed", resolveProxy, undefined, 1500)).text, /Delayed content/);
            const environment = await fetchPage("http://public.test/environment", resolveProxy);
            assert.match(environment.text, /Node: undefined undefined/);
            assert.match(environment.text, /Network: undefined undefined undefined undefined/);
            assert.match(environment.text, /Frame: undefined/);
            const plain = await fetchPage("http://public.test/markdown", resolveProxy);
            assert.equal(plain.plain, true);
            assert.equal(plain.text.trim(), "# Negotiated Markdown\n\nOriginal **text**");
            const redirected = await fetchPage("http://public.test/redirect", resolveProxy);
            assert.equal(redirected.plain, true);
            assert.equal(redirected.text, plain.text);
            const workers = await fetchPage("http://public.test/workers", resolveProxy);
            assert.equal(workers.text, "Worker blocked");
            assert.equal(requests.some(request => request.url === "/worker.js"), false);
            await fetchPage("http://public.test/static", resolveProxy);
            for (const route of ["private-resource", "failed-resources", "many-resources"]) {
                assert.match((await fetchPage(`http://public.test/${route}`, resolveProxy)).text, /content|text/);
            }
            for (const [route, error] of [["download", /download/i], ["private", /private/],
                ["empty", /No meaningful content/], ["stall", /timed out/], ["status", /HTTP 404/]]) {
                await assert.rejects(fetchPage(`http://public.test/${route}`, resolveProxy), error);
            }
            await assert.rejects(fetchPage("file:///test", resolveProxy), /HTTP/);
            await assert.rejects(fetchPage("http://127.0.0.1/", resolveProxy), /private/);
            for (const options of windows) {
                assert.equal(options.show, false);
                assert.equal(options.webPreferences.sandbox, true);
                assert.equal(options.webPreferences.nodeIntegration, false);
                assert.equal(options.webPreferences.contextIsolation, true);
                assert.equal(options.webPreferences.session.storagePath, null);
            }
            assert.equal(new Set(windows.map(options => options.webPreferences.session)).size, windows.length);
            for (const request of requests.filter(request => ["/dynamic", "/environment", "/markdown", "/static"].includes(request.url))) {
                assert.equal(request.headers.cookie, undefined);
                assert.doesNotMatch(request.headers["user-agent"], /Electron|SiYuan/i);
                assert.equal(request.headers.dnt, "1");
                assert.match(request.headers.accept, /^text\/markdown,/);
            }
            assert.ok(targets.length > 5);
            assert.ok(targets.every(target => target === "93.184.216.34:80"));
            assert.equal(BrowserWindow.getAllWindows().length, 0);
            console.log("Rendered page fetch passed");
        } finally {
            for (const socket of sockets) {
                socket.destroy();
            }
            server.closeAllConnections();
            server.close();
            proxy.close();
        }
    }).then(() => app.exit(0)).catch(error => {
        console.error(error);
        app.exit(1);
    });
}
