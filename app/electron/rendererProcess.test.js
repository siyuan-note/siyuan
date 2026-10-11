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
    const vm = require("node:vm");
    const source = fs.readFileSync(path.join(__dirname, "main.js"), "utf8");
    const start = source.indexOf('app.commandLine.appendSwitch("auto-detect"');
    const end = source.indexOf("// Support set Chromium command line arguments", start);
    assert.ok(start >= 0 && end > start);
    vm.runInNewContext(source.slice(start, end), {app, remoteKernelTarget: false});
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
    const open = async (url, isolatedSession) => {
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
            const markers = [];
            const kernelExits = [];
            const workspaceExits = [];
            const crashStart = source.indexOf('    app.on("render-process-gone"');
            const crashEnd = source.indexOf("\n    const resetTrayMenu =", crashStart);
            assert.ok(crashStart >= 0 && crashEnd > crashStart);
            vm.runInNewContext(source.slice(crashStart, crashEnd), {
                app, workspaces, writeLog: () => {}, cleanupBlockDragSessions: () => {},
                updateInstallPromise: undefined, systemShutdownState: 0, systemShutdownNone: 0,
                expectedRendererExitIds: new Set(), handledCrashWebContents: new Set(), bootWindow: undefined,
                safeModeReasons: new Set(["crashed"]),
                writeAppCrashMarker: workspace => markers.push(workspace.webContentsId),
                requestKernelExit: port => kernelExits.push(port),
                exitApp: port => workspaceExits.push(port),
            });

            children[1].forcefullyCrashRenderer();
            const deadline = Date.now() + 10000;
            while (crashes.length < 4 && Date.now() < deadline) {
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.deepEqual(crashes.map(item => item.id).sort((a, b) => a - b),
                [main, ...children].map(contents => contents.id).sort((a, b) => a - b));
            assert.ok(crashes.every(item => item.reason === "crashed"));
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
