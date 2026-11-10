// 本文件会在真实 Electron 中重新执行，那里没有外部的 tsx 钩子，需自行注册后才能加载 TS 模块。
require("tsx/cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {createResponseHeaderFilter} = require("./sessionHeaders");

const installResponseHeaders = (currentWindow, kernelTarget) => {
    currentWindow.webContents.session.webRequest.onHeadersReceived(createResponseHeaderFilter(kernelTarget));
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
    const {applyStartupSwitches} = require("../startup/startupSwitches");
    applyStartupSwitches(false);
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
        } catch (error) {
            console.error(error);
            exitCode = 1;
        } finally {
            windows.forEach(win => win.destroy());
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
            if (exitCode) {
                app.exit(exitCode);
            } else {
                // 正常退出等待 Chromium 会话收尾，释放临时配置目录的文件句柄。
                app.once("will-quit", () => console.log("Iframe CORS passed"));
                app.quit();
            }
        }
    }).catch(error => { console.error(error); app.exit(1); });
}
