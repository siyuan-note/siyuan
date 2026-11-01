const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const vm = require("node:vm");
const {parseMarkdownLaunch} = require("./launch");

const source = readFileSync(path.join(__dirname, "../main.js"), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test("an unsuccessful standalone launch exits only after every queued file has settled", async () => {
    const events = [];
    let complete;
    const context = vm.createContext({app: {isPackaged: true, quit: () => events.push("quit")},
        process: {argv: ["siyuan.exe", "--markdown=first.md"], cwd: () => "C:\\notes"}, parseMarkdownLaunch,
        createMarkdownLifecycle: () => ({busy: () => false}), BrowserWindow: {getAllWindows: () => []},
        workspaces: [], localKernelStartups: new Map(), updateInstallPromise: undefined,
        systemShutdownState: 0, systemShutdownNone: 0, writeLog() {},
        manager: {handleLaunch: async argv => {
            events.push(argv[0]);
            if (argv[0].includes("first")) await new Promise(resolve => { complete = resolve; });
        }},
    });
    vm.runInContext(section("const initialMarkdownArguments =", "// 在单实例锁"), context);
    vm.runInContext("markdownWindows = manager; drainMarkdownLaunches(); routeMarkdownLaunch(['--markdown=second.md']);", context);
    assert.deepEqual(events, ["--markdown=first.md"]);
    complete();
    await vm.runInContext("markdownLaunchTask", context);
    assert.deepEqual(events, ["--markdown=first.md", "--markdown=second.md", "quit"]);
});

test("closing the last workspace or showing its crash window preserves independent Markdown windows", () => {
    for (const crash of [false, true]) {
        const makeWindow = (id, url) => ({id, webContents: {id, isDevToolsOpened: () => false}, getURL: () => url,
            isDestroyed() { return !!this.destroyed; }, destroy() { this.destroyed = true; },
            getNormalBounds: () => ({}), isMaximized: () => false, isFullScreen: () => false});
        const main = makeWindow(1, "https://127.0.0.1:6806/stage/build/app/");
        const markdown = makeWindow(2, "siyuan-markdown://session/");
        const error = makeWindow(3, "file:///error.html");
        const workspace = {browserWindow: main, kernelTarget: {origin: "https://127.0.0.1:6806"}};
        const context = vm.createContext({workspace, workspaces: [workspace], URL, process: {platform: "win32"},
            BrowserWindow: {getAllWindows: () => [main, markdown, ...(crash ? [error] : [])]},
            markdownWindows: {owns: contents => contents === markdown.webContents}, markdownLifecycle: {hasWindows: () => true},
            resetWindowStateOnRestart: false, fs: {writeFileSync() {}}, windowStatePath: "unused", writeLog() {},
            keepAppOpenDuringSystemShutdown: false, keepAppOpenDuringUpdate: false, markExpectedRendererExit() {},
            globalShortcut: {unregisterAll() {}}, relaunchConnection: () => assert.fail("workspace exit relaunched app"),
            app: {exit: () => assert.fail("workspace exit killed Markdown")},
        });
        vm.runInContext(section("const exitWorkspace =", "const exitApp ="), context);
        vm.runInContext(`exitWorkspace(workspace, ${crash ? 3 : "undefined"})`, context);
        assert.equal(main.destroyed, true);
        assert.equal(markdown.destroyed, undefined);
        assert.equal(error.destroyed, undefined);
        assert.equal(context.workspaces.length, 0);
    }
});

test("second-instance routes Markdown with sender cwd before remote mode rejection", () => {
    const app = Object.assign(new EventEmitter(), {isPackaged: true});
    const launches = [];
    const context = vm.createContext({app, process: {cwd: () => "C:\\primary"}, writeLog() {},
        updateInstallPromise: undefined, remoteKernelArgError: new Error("invalid remote"),
        routeMarkdownLaunch: (argv, cwd) => {
            launches.push(parseMarkdownLaunch(argv, cwd, {platform: "win32"}));
            return launches.at(-1).requested;
        },
    });
    vm.runInContext(section('app.on("second-instance"', 'app.on("activate"'), context);
    app.emit("second-instance", {}, ["siyuan.exe", "relative.md"], "D:\\sender");
    assert.deepEqual(launches, [{requested: true, files: ["D:\\sender\\relative.md"], newDocument: false}]);
});

test("macOS open-file received before readiness selects only the lightweight startup", () => {
    const app = Object.assign(new EventEmitter(), {isReady: () => false});
    const launches = [];
    const context = vm.createContext({app, markdownStartup: false, isMarkdownPath: file => /\.md$/i.test(file),
        updateInstallPromise: undefined, systemShutdownState: 0, systemShutdownNone: 0,
        routeMarkdownLaunch: argv => launches.push(argv)});
    vm.runInContext(section('app.on("open-file"', "if (isDevEnv && process.defaultApp"), context);
    let prevented = false;
    app.emit("open-file", {preventDefault: () => { prevented = true; }}, "/notes/file.md");
    assert.equal(prevented, true);
    assert.equal(context.markdownStartup, true);
    assert.deepEqual(JSON.parse(JSON.stringify(launches)), [["--markdown=/notes/file.md"]]);
});

test("the workspace menu opens only a blank Markdown window from its trusted main frame", async () => {
    const ipcMain = new EventEmitter();
    const calls = [];
    const origin = "https://remote.example.com";
    const mainFrame = {url: origin + "/stage/build/app/"};
    const sender = {id: 1, mainFrame};
    const context = vm.createContext({ipcMain, URL, initializedWindowIds: new Set([1]),
        getWindowKernelTarget: id => id === 1 ? {origin, mode: "remote"} : undefined,
        workspaces: [{webContentsId: 1}], updateInstallPromise: undefined, systemShutdownState: 0, systemShutdownNone: 0,
        markdownLifecycle: {busy: () => false}, markdownWindows: {open: async (...args) => calls.push(args)}, writeLog() {},
    });
    vm.runInContext(section('    ipcMain.on("siyuan-open-markdown"', '    ipcMain.on("siyuan-manage-connections"'), context);
    ipcMain.emit("siyuan-open-markdown", {sender, senderFrame: mainFrame}, {path: "C:\\private.md"});
    assert.deepEqual(calls, [[]]);
    ipcMain.emit("siyuan-open-markdown", {sender, senderFrame: {url: mainFrame.url}});
    mainFrame.url = "https://other.example.com/stage/build/app/";
    ipcMain.emit("siyuan-open-markdown", {sender, senderFrame: mainFrame});
    mainFrame.url = origin + "/check-auth";
    ipcMain.emit("siyuan-open-markdown", {sender, senderFrame: mainFrame});
    ipcMain.emit("siyuan-open-markdown", {sender: {...sender, id: 2}, senderFrame: mainFrame});
    await Promise.resolve();
    assert.deepEqual(calls, [[]]);
});

test("update cancellation protects Markdown before touching workspaces or launching an installer", async () => {
    const context = vm.createContext({markdownLifecycle: {prepare: async reason => {
        assert.equal(reason, "update"); return false;
    }}, getSystemShutdownPorts: () => assert.fail("kernels touched before Markdown consent")});
    vm.runInContext(section("const coordinateUpdateInstall =", "const beginUpdateInstall ="), context);
    await assert.rejects(vm.runInContext("coordinateUpdateInstall({})", context), {code: "MARKDOWN_EXIT_CANCELED"});
});

test("update installation waits for Markdown closing after kernels have exited", async () => {
    const events = [];
    const context = vm.createContext({markdownLifecycle: {
        prepare: async () => { events.push("prepare"); return true; },
        finish: async () => { events.push("close-markdown"); return true; },
    }, getSystemShutdownPorts: () => ["6806", "6807"], kernelProcesses: new Map(), expectedKernelExitPorts: new Set(),
    workspaces: [], writeLog() {}, closeUpdateKernelStage: async ports => {
        events.push("kernels:" + ports.join(",")); return [{data: {installPkgPath: "installer"}}];
    }, validateUpdateInstallPackage: () => "installer", launchUpdateInstallPackage: async () => events.push("installer"),
    app: {exit: () => events.push("exit")}, keepAppOpenDuringUpdate: true});
    vm.runInContext(section("const coordinateUpdateInstall =", "const beginUpdateInstall ="), context);
    await vm.runInContext("coordinateUpdateInstall({initiatingPort: '6806'})", context);
    assert.deepEqual(events, ["prepare", "kernels:6807", "kernels:6806", "close-markdown", "installer", "exit"]);
});

test("system shutdown without a kernel still waits for Markdown and honors cancellation", async () => {
    for (const [prepared, closed, exits] of [[false, true, 0], [true, false, 0], [true, true, 1]]) {
        let actualExits = 0;
        const context = vm.createContext({markdownLifecycle: {prepare: async () => prepared, finish: async () => closed, cancel() {}},
            systemShutdownState: 0, systemShutdownNone: 0, systemShutdownEnding: 1, systemShutdownForced: 2,
            gracefulSystemShutdownPromise: undefined, keepAppOpenDuringSystemShutdown: false,
            getSystemShutdownPorts: () => [], bootWindows: new Set(), workspaces: [], writeLog() {},
            requestGracefulKernelExit: () => assert.fail("unexpected kernel"), exitApp() {},
            app: {exit: () => actualExits++},
        });
        vm.runInContext(section("const resetSystemShutdown =", "const beginForcedSystemShutdown ="), context);
        await vm.runInContext("beginGracefulSystemShutdown(); gracefulSystemShutdownPromise", context);
        assert.equal(actualExits, exits);
        if (!exits) assert.equal(context.systemShutdownState, 0);
    }
});
