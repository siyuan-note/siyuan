const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
const headersStart = source.indexOf("    currentWindow.webContents.session.webRequest.onHeadersReceived(");
const headersEnd = source.indexOf('\n    currentWindow.webContents.on("did-finish-load"', headersStart);
assert.ok(headersStart >= 0 && headersEnd > headersStart);

const installResponseHeaders = (currentWindow, kernelTarget) => {
    vm.runInNewContext(source.slice(headersStart, headersEnd), {currentWindow, kernelTarget, URL});
};

if (!process.versions.electron) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");

    test("internet response filtering preserves CORS permissions and remote document CSP", () => {
        for (const mode of ["local", "remote"]) {
            let filter;
            installResponseHeaders({webContents: {session: {webRequest: {
                onHeadersReceived: callback => { filter = callback; },
            }}}}, {mode, origin: "https://kernel.invalid"});
            for (const pathname of ["/check-auth", "/stage/build/app/", "/stage/build/app/window.html",
                "/stage/build/app/settings.html", "/asset.js"]) {
                for (const origin of ["https://kernel.invalid", "https://cdn.invalid"]) {
                    for (const name of ["Access-Control-Allow-Origin", "access-control-allow-origin"]) {
                        const cors = ["https://embed.invalid"];
                        const csp = ["default-src 'self'; frame-src 'none'"];
                        const responseHeaders = {
                            [name]: cors,
                            "Access-Control-Allow-Credentials": ["true"],
                            "Access-Control-Allow-Headers": ["X-Player"],
                            "Access-Control-Allow-Methods": ["GET, OPTIONS"],
                            "X-Frame-Options": ["DENY"],
                            "Content-Security-Policy": csp,
                        };
                        let result;
                        filter({url: origin + pathname, responseHeaders}, value => { result = value.responseHeaders; });
                        assert.equal(result[name], cors);
                        assert.deepEqual(result["Access-Control-Allow-Credentials"], ["true"]);
                        assert.deepEqual(result["Access-Control-Allow-Headers"], ["X-Player"]);
                        assert.deepEqual(result["Access-Control-Allow-Methods"], ["GET, OPTIONS"]);
                        assert.equal(result["X-Frame-Options"], undefined);
                        assert.equal(result["Content-Security-Policy"], mode === "remote" &&
                            origin === "https://kernel.invalid" && pathname !== "/asset.js" ? csp : undefined);
                    }
                }
            }
            filter({url: "https://cdn.invalid/asset.js", responseHeaders: {}}, result => {
                assert.deepEqual(Object.keys(result.responseHeaders), []);
            });
        }
    });

    test("cross-site iframe scripts and fetches load in main and detached Electron windows", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-iframe-cors-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, timeout: 60000, windowsHide: true,
            });
            assert.match(stdout, /Iframe CORS passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        }
    });
} else {
    const {app, BrowserWindow} = require("electron");
    const http = require("node:http");
    const switchesStart = source.indexOf('app.commandLine.appendSwitch("auto-detect"');
    const switchesEnd = source.indexOf("// Support set Chromium command line arguments", switchesStart);
    assert.ok(switchesStart >= 0 && switchesEnd > switchesStart);
    vm.runInNewContext(source.slice(switchesStart, switchesEnd), {
        app, remoteKernelTarget: false, ...require("./chromiumSwitches"),
    });
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();
    app.on("window-all-closed", () => {});

    app.whenReady().then(async () => {
        const windows = [];
        const requests = [];
        let origin;
        let frameOrigin;
        const server = http.createServer((request, response) => {
            response.setHeader("Content-Type", "text/html");
            if (request.url === "/frame") {
                response.setHeader("X-Frame-Options", "DENY");
                response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
                response.end('<!doctype html><script crossorigin="anonymous" src="' + origin + '/player.js"></script>');
            } else if (request.url === "/player.js") {
                requests.push({path: request.url, origin: request.headers.origin});
                response.setHeader("Content-Type", "text/javascript");
                response.setHeader("Access-Control-Allow-Origin", frameOrigin);
                response.end('fetch("' + origin + '/media", {headers: {"X-Player": "test"}})' +
                    ".then(response => response.text()).then(text => { document.title = text; })" +
                    '.catch(() => { document.title = "fetch-failed"; });');
            } else if (request.url === "/media") {
                requests.push({path: request.url, method: request.method, origin: request.headers.origin});
                response.setHeader("Access-Control-Allow-Origin", frameOrigin);
                response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
                response.setHeader("Access-Control-Allow-Headers", "X-Player");
                response.end("media-loaded");
            } else {
                response.end('<!doctype html><iframe sandbox="allow-same-origin allow-scripts" src="' +
                    frameOrigin + '/frame"></iframe>');
            }
        });
        let exitCode = 0;
        try {
            await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
            origin = "http://127.0.0.1:" + server.address().port;
            frameOrigin = "http://localhost:" + server.address().port;
            for (const pathname of ["/stage/build/app/", "/stage/build/app/window.html"]) {
                const win = new BrowserWindow({show: false, webPreferences: {
                    backgroundThrottling: false, nodeIntegration: true, contextIsolation: false, webSecurity: false,
                }});
                windows.push(win);
                installResponseHeaders(win, {mode: "local", origin});
                await win.loadURL(origin + pathname);
                const frame = win.webContents.mainFrame.frames.find(item => item.url === frameOrigin + "/frame");
                assert.ok(frame, "cross-site iframe loaded");
                assert.notEqual(frame.processId, win.webContents.mainFrame.processId);
                const title = await frame.executeJavaScript(`new Promise(resolve => {
                    const deadline = Date.now() + 5000;
                    const check = () => {
                        if (document.title || Date.now() >= deadline) {
                            resolve(document.title);
                        } else {
                            setTimeout(check, 20);
                        }
                    };
                    check();
                })`);
                assert.equal(title, "media-loaded");
            }
            assert.equal(requests.filter(request => request.path === "/player.js").length, 2);
            assert.ok(requests.some(request => request.method === "OPTIONS"));
            assert.equal(requests.filter(request => request.method === "GET").length, 2);
            assert.ok(requests.every(request => request.origin === frameOrigin));
            console.log("Iframe CORS passed");
        } catch (error) {
            console.error(error);
            exitCode = 1;
        } finally {
            windows.forEach(win => win.destroy());
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            app.exit(exitCode);
        }
    }).catch(error => { console.error(error); app.exit(1); });
}
