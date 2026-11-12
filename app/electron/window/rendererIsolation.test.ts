// 本文件会在真实 Electron 中重新执行，那里没有外部的 tsx 钩子，需自行注册后才能加载 TS 模块。
require("tsx/cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
    const {test} = require("node:test");
    const {execFile} = require("node:child_process");
    const {promisify} = require("node:util");
    test("workspace windows share a renderer without sharing crashes across origins or sessions", async () => {
        const profile = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-renderer-process-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await promisify(execFile)(require("electron"), [__filename, profile], {
                env, timeout: 60000, windowsHide: true,
            });
            assert.match(stdout, /Renderer process isolation passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            fs.rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 200});
        }
    });
} else {
    const {app, BrowserWindow, session} = require("electron");
    const http = require("node:http");
    const {applyStartupSwitches} = require("../startup/startupSwitches");
    applyStartupSwitches(false);
    app.setPath("userData", process.argv[2]);
    app.disableHardwareAcceleration();

    const windows = [];
    const servers = [];
    const crashes = [];
    app.on("window-all-closed", () => {});
    app.on("render-process-gone", (event, contents, details) => {
        crashes.push({id: contents.id, reason: details.reason});
    });

    const serve = async () => {
        const server = http.createServer((request, response) => {
            response.setHeader("Content-Type", "text/html");
            response.end("<!doctype html><title>Renderer process isolation</title><p>Workspace</p>");
        });
        servers.push(server);
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        return "http://127.0.0.1:" + server.address().port;
    };
    const open = async (url, isolatedSession = undefined) => {
        const win = new BrowserWindow({show: false, webPreferences: {
            backgroundThrottling: false,
            contextIsolation: false,
            nodeIntegration: true,
            webSecurity: !!isolatedSession,
            ...(isolatedSession ? {session: isolatedSession} : {}),
        }});
        windows.push(win);
        await win.loadURL(url);
        assert.ok(win.webContents.getOSProcessId() > 0);
        return win.webContents;
    };
    app.whenReady().then(async () => {
        let exitCode = 0;
        try {
            const origin = await serve();
            const otherOrigin = await serve();
            const main = await open(origin + "/stage/build/app/");
            const children = [];
            for (let i = 0; i < 3; i++) {
                children.push(await open(origin + "/stage/build/app/window.html?block=" + i));
            }
            const otherWorkspace = await open(otherOrigin + "/stage/build/app/");
            const otherSession = await open(origin + "/stage/build/app/window.html",
                session.fromPartition("renderer-process-isolation"));
            for (const child of children) {
                assert.equal(child.getOSProcessId(), main.getOSProcessId());
            }
            assert.notEqual(otherWorkspace.getOSProcessId(), main.getOSProcessId());
            assert.notEqual(otherSession.getOSProcessId(), main.getOSProcessId());

            const workspaces = [
                {webContentsId: main.id, port: 6806, ownsKernel: true},
                {webContentsId: otherWorkspace.id, port: 6807, ownsKernel: true},
            ];
            // 工作空间从共享运行期状态读取；崩溃后的副作用仍可替换，以便在真实 Electron 里只观察不执行。
            require("../shared/runtime").state.workspaces = workspaces;
            const markers = [];
            const kernelExits = [];
            const workspaceExits = [];
            const {createRenderProcessGoneHandler} = require("./rendererCrash");
            app.on("render-process-gone", createRenderProcessGoneHandler({
                loadBootWindow: () => {},
                takeExpectedRendererExit: () => false,
                safeModeReasons: new Set(["crashed"]),
                exitWorkspace: workspace => workspaceExits.push(workspace.webContentsId),
                writeAppCrashMarker: workspace => markers.push(workspace.webContentsId),
                requestKernelExit: port => kernelExits.push(port),
                exitApp: port => workspaceExits.push(port),
            }));

            void children[1].executeJavaScript("process.crash()").catch(() => {});
            const deadline = Date.now() + 10000;
            while (crashes.length < 4 && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.deepEqual(crashes.map(item => item.id).sort((a, b) => a - b),
                [main, ...children].map(contents => contents.id).sort((a, b) => a - b));
            assert.ok(crashes.every(item => item.reason === "crashed"), JSON.stringify(crashes));
            assert.deepEqual(markers, [main.id]);
            assert.deepEqual(kernelExits, [6806]);
            assert.deepEqual(workspaceExits, [6806]);
            for (const contents of [otherWorkspace, otherSession]) {
                assert.equal(contents.isCrashed(), false);
                assert.equal(await contents.executeJavaScript("document.title"), "Renderer process isolation");
            }
            console.log("Renderer process isolation passed");
        } catch (error) {
            console.error(error);
            exitCode = 1;
        } finally {
            windows.forEach(win => win.destroy());
            servers.forEach(server => server.close());
            app.exit(exitCode);
        }
    });
}
