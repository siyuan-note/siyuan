const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");
const {EventEmitter} = require("node:events");

const source = readFileSync(path.join(__dirname, "main.js"), "utf8");
const helpers = source.slice(source.indexOf("const getAvailablePort ="), source.indexOf("const initKernel ="));
const startup = source.slice(source.indexOf("    const startupStartedAt ="), source.indexOf("    connectionManager = createConnectionManager"));

const setup = (overrides = {}) => {
    const events = [];
    const window = {
        isDestroyed: () => false,
        setOpacity: value => events.push(["opacity", value]),
        once: (name, callback) => { window[name] = callback; },
        show: () => events.push("show"),
        minimize: () => events.push("minimize"),
    };
    const context = vm.createContext({
        Date, Promise, process: {platform: "win32"}, setImmediate: callback => callback(),
        isDevEnv: false, workspaces: ["workspace"], kernelPort: 6806,
        localKernelStartups: new Map(),
        openAsHidden: false, bootWindow: window,
        remoteKernelArgError: false, remoteKernelTarget: false, firstOpen: false, lastWorkspaceMissing: false,
        readAppCrashInfo: () => undefined, getArg: () => "",
        writeLog: () => {},
        createBootWindow: () => events.push("create"),
        loadBootWindow: () => events.push(["load", context.kernelPort]),
        gNet: {createServer: () => ({
            on() {}, listen: (port, callback) => callback(),
            address: () => ({port: 7421}), close: callback => callback(),
        })},
        ...overrides,
    });
    vm.runInContext(helpers, context);
    return {context, events, window};
};

test("ordinary startup creates synchronously and loads once with the allocated port before showing", async () => {
    const {context, events, window} = setup();
    vm.runInContext(startup, context);
    assert.deepEqual(events, ["create"]);
    assert.equal(await vm.runInContext("preparedBoot.ready", context), 7421);
    assert.deepEqual(events, ["create", ["opacity", 0], ["load", 7421]]);
    window["ready-to-show"]();
    assert.deepEqual(events.slice(-2), ["show", ["opacity", 1]]);
});

test("special startup branches do not create a boot window", () => {
    for (const overrides of [
        {remoteKernelArgError: true}, {remoteKernelTarget: {}}, {firstOpen: true},
        {readAppCrashInfo: () => ({})}, {lastWorkspaceMissing: true},
    ]) {
        const {context, events} = setup(overrides);
        vm.runInContext(startup, context);
        assert.deepEqual(events, []);
    }
});

test("explicit ports and workspace-free development skip allocation", async () => {
    for (const [overrides, expected] of [[{}, "9000"], [{isDevEnv: true, workspaces: []}, 6806]]) {
        const {context} = setup({...overrides, gNet: {createServer: () => assert.fail("unexpected allocation")}});
        assert.equal(await vm.runInContext("getAvailablePort('9000')", context), expected);
    }
});

test("port allocation failure does not load or show the boot window", async () => {
    const {context, events} = setup({gNet: {createServer: () => {
        let fail;
        return {on: (name, callback) => { fail = callback; }, listen: () => fail(new Error("port unavailable"))};
    }}});
    vm.runInContext(startup, context);
    assert.equal(await vm.runInContext("preparedBoot.ready", context), "");
    assert.deepEqual(events, ["create"]);
});

test("hidden startup stays minimized and destroyed windows are not shown", async () => {
    const hidden = setup({openAsHidden: true});
    vm.runInContext(startup, hidden.context);
    await vm.runInContext("preparedBoot.ready", hidden.context);
    assert.deepEqual(hidden.events, ["create", ["load", 7421], "minimize"]);
    const destroyed = setup();
    vm.runInContext(startup, destroyed.context);
    destroyed.window.isDestroyed = () => true;
    await vm.runInContext("preparedBoot.ready", destroyed.context);
    assert.deepEqual(destroyed.events, ["create"]);
});

test("concurrent port allocation resolves each request with its own reserved port", async () => {
    const close = [];
    let nextPort = 7420;
    const {context} = setup({gNet: {createServer: () => {
        const port = ++nextPort;
        return {on() {}, listen: (_port, callback) => callback(), address: () => ({port}),
            close: callback => close.push(callback)};
    }}});
    const first = vm.runInContext("getAvailablePort()", context);
    const second = vm.runInContext("getAvailablePort()", context);
    close[1]();
    close[0]();
    assert.deepEqual(await Promise.all([first, second]), [7421, 7422]);
});

test("each boot window can show after another workspace creates its boot window", () => {
    const first = setup();
    const unrelated = {isDestroyed: () => false, show: () => assert.fail("unrelated window")};
    vm.runInContext("showLocalBootWindow(bootWindow, 6806, 'en')", first.context);
    first.context.bootWindow = unrelated;
    first.window["ready-to-show"]();
    assert.deepEqual(first.events.slice(-2), ["show", ["opacity", 1]]);
});

test("appearance recovery reloads only the affected boot window with its original connection", () => {
    class Window extends EventEmitter {
        isDestroyed() { return !!this.destroyed; }
        destroy() { this.destroyed = true; this.emit("closed"); }
        loadFile(file, options) { this.loaded = {file, query: options.query}; return Promise.resolve(); }
    }
    const context = vm.createContext({
        BrowserWindow: Window, bootWindows: new Set(), bootWindow: undefined, bootIndexPath: "",
        appDir: "app", appVer: "3.8.6", isDevEnv: false, path, kernelPort: 9999,
        screen: {getPrimaryDisplay: () => ({size: {width: 1000}, workAreaSize: {height: 800}})},
        remoteKernelTarget: undefined, writeLog() {}, getArg: () => "en",
    });
    vm.runInContext(source.slice(source.indexOf("const loadBootWindow ="), source.indexOf("const getAvailablePort =")), context);
    vm.runInContext("const a = createBootWindow(); loadBootWindow(false, a, 6806, 'en');" +
        "const b = createBootWindow(); loadBootWindow(false, b, 6807, 'ja'); a.emit('unresponsive');", context);
    const [a, b] = Array.from(context.bootWindows);
    assert.equal(a.loaded.query.port, 6806);
    assert.equal(a.loaded.query.lang, "en");
    assert.equal(a.loaded.query.appearance, "0");
    assert.equal(b.loaded.query.port, 6807);
    assert.equal(b.loaded.query.lang, "ja");
    assert.equal(b.loaded.query.appearance, undefined);
    a.destroy();
    assert.deepEqual(Array.from(context.bootWindows), [b]);
});

const mainWindowSetup = () => {
    const timers = new Map();
    const ipcMain = new EventEmitter();
    let windowId = 0;
    class Window extends EventEmitter {
        constructor() {
            super();
            this.webContents = Object.assign(new EventEmitter(), {id: ++windowId,
                send: (...args) => { this.messages = [...(this.messages || []), args]; },
                session: {webRequest: {onBeforeSendHeaders() {}, onHeadersReceived() {}}}});
        }
        isDestroyed() { return !!this.destroyed; }
        destroy() { this.destroyed = true; this.emit("closed"); }
        show() { this.shown = true; }
        setPosition() {}
        unmaximize() {}
    }
    const context = vm.createContext({
        app: {isReady: () => true}, getKernelTarget: port => ({port, mode: "local", ownsKernel: true}),
        localKernelStartups: new Map(), workspaces: [], bootWindow: undefined,
        getWorkspaceStartupKey: workspace => workspace,
        fs: {readFileSync: () => "{}"}, windowStatePath: "state.json", path, appDir: "app", appVer: "3.8.6",
        screen: {getPrimaryDisplay: () => ({size: {width: 1000}, workAreaSize: {height: 800}})},
        BrowserWindow: Window, remote: {enable() {}}, bindSpellcheckContextMenu() {}, bindTopBarContextMenu() {},
        getTitleBarOverlayOptions: require("./windowControlsOverlay").getTitleBarOverlayOptions,
        rememberWindowKernelTarget() {}, windowNavigate() {}, writeLog() {}, process: {platform: "win32", argv: []},
        net: {fetch: () => new Promise(() => {})}, getServer: port => "https://127.0.0.1:" + port,
        setStartupApplicationMenu() {}, isOpenAsHidden: () => false, ipcMain,
        setTimeout: callback => { const key = {}; timers.set(key, callback); return key; },
        clearTimeout: key => timers.delete(key),
    });
    vm.runInContext(source.slice(source.indexOf("const initMainWindow ="), source.indexOf("const showWindow =")), context);
    return {context, ipcMain, timers, Window};
};

test("main windows close their own boot windows in either frontend readiness order", () => {
    for (const first of [0, 1]) {
        const {context, ipcMain, timers, Window} = mainWindowSetup();
        const boots = [new Window(), new Window()];
        boots.forEach((window, index) => {
            context.localKernelStartups.set("workspace-" + index, {window, workspace: "workspace-" + index, port: 6806 + index});
            vm.runInContext(`initMainWindow(${6806 + index})`, context);
        });
        assert.equal(context.localKernelStartups.size, 0);
        assert.deepEqual(Array.from(context.workspaces, item => item.workspaceDir), ["workspace-0", "workspace-1"]);
        ipcMain.emit("siyuan-ready-to-show", {sender: {}});
        assert.equal(boots.some(window => window.destroyed), false);
        ipcMain.emit("siyuan-ready-to-show", {sender: context.workspaces[first].browserWindow.webContents});
        assert.equal(boots[first].destroyed, true);
        assert.equal(boots[1 - first].destroyed, undefined);
        assert.equal(context.workspaces[first].browserWindow.shown, true);
        assert.equal(context.workspaces[1 - first].browserWindow.shown, undefined);
        assert.equal(ipcMain.listenerCount("siyuan-ready-to-show"), 1);
        ipcMain.emit("siyuan-ready-to-show", {sender: context.workspaces[1 - first].browserWindow.webContents});
        assert.equal(boots.every(window => window.destroyed), true);
        assert.equal(ipcMain.listenerCount("siyuan-ready-to-show"), 0);
        assert.equal(timers.size, 0);
    }
});

test("main window timeout and closure clean up their own boot windows and readiness listeners", () => {
    const {context, ipcMain, timers, Window} = mainWindowSetup();
    const boots = [new Window(), new Window()];
    boots.forEach((window, index) => {
        context.localKernelStartups.set("workspace-" + index, {window, workspace: "workspace-" + index, port: 6806 + index});
        vm.runInContext(`initMainWindow(${6806 + index})`, context);
    });
    const [key, timeout] = timers.entries().next().value;
    timers.delete(key);
    timeout();
    assert.equal(boots[0].destroyed, true);
    assert.equal(boots[1].destroyed, undefined);
    assert.equal(context.workspaces[0].browserWindow.shown, true);
    context.workspaces[1].browserWindow.destroy();
    assert.equal(boots[1].destroyed, true);
    assert.equal(ipcMain.listenerCount("siyuan-ready-to-show"), 0);
    assert.equal(timers.size, 0);
});

test("deep-link startup waits for the interface before showing the window and forwarding the link", () => {
    const {context, ipcMain, Window} = mainWindowSetup();
    const boot = new Window();
    context.localKernelStartups.set("workspace", {window: boot, workspace: "workspace", port: 6806});
    const url = "siyuan://blocks/20261025000000-abcdefg";
    context.process.argv.push(url);
    vm.runInContext("initMainWindow(6806)", context);
    const window = context.workspaces[0].browserWindow;
    window.webContents.emit("did-finish-load");
    assert.equal(window.shown, undefined);
    assert.equal(window.messages, undefined);
    assert.equal(boot.destroyed, undefined);
    ipcMain.emit("siyuan-ready-to-show", {sender: window.webContents});
    assert.equal(window.shown, true);
    assert.equal(boot.destroyed, true);
    assert.deepEqual(window.messages, [["siyuan-open-url", url]]);
});

test("ready hidden startup stays minimized and restores its saved maximized state later", () => {
    const {context, ipcMain, Window} = mainWindowSetup();
    const boot = new Window();
    context.isOpenAsHidden = () => true;
    context.fs.readFileSync = () => '{"isMaximized":true}';
    context.localKernelStartups.set("workspace", {window: boot, workspace: "workspace", port: 6806});
    vm.runInContext("initMainWindow(6806)", context);
    const window = context.workspaces[0].browserWindow;
    window.minimize = () => { window.minimized = true; };
    window.maximize = () => { window.maximized = true; };
    ipcMain.emit("siyuan-ready-to-show", {sender: window.webContents});
    assert.equal(window.minimized, true);
    assert.equal(window.shown, undefined);
    assert.equal(window.maximized, undefined);
    assert.equal(boot.destroyed, true);
    window.emit("restore");
    assert.equal(window.maximized, true);
});

test("system shutdown includes every booting workspace and closes only successful exits", async () => {
    for (const failedPort of [undefined, 6807]) {
        const {context, Window} = mainWindowSetup();
        const boots = [new Window(), new Window()];
        boots.forEach((window, index) => { window.kernelPort = 6806 + index; });
        let appExits = 0;
        Object.assign(context, {
            bootWindows: new Set(boots), remoteKernelTarget: undefined,
            systemShutdownState: 0, systemShutdownNone: 0, systemShutdownEnding: 1, systemShutdownForced: 2,
            gracefulSystemShutdownPromise: undefined, keepAppOpenDuringSystemShutdown: false,
            requestGracefulKernelExit: async port => port !== failedPort,
            exitApp() {}, showWindow: window => window.show(), app: {exit: () => appExits++},
        });
        vm.runInContext(source.slice(source.indexOf("const getSystemShutdownPorts ="),
            source.indexOf("const requestGracefulKernelExit =")), context);
        vm.runInContext(source.slice(source.indexOf("const resetSystemShutdown ="),
            source.indexOf("const beginForcedSystemShutdown =")), context);
        assert.deepEqual(Array.from(vm.runInContext("getSystemShutdownPorts()", context)), [6806, 6807]);
        vm.runInContext("beginGracefulSystemShutdown()", context);
        await context.gracefulSystemShutdownPromise;
        assert.equal(boots[0].destroyed, true);
        assert.equal(!!boots[1].destroyed, failedPort === undefined);
        assert.equal(!!boots[1].shown, failedPort !== undefined);
        assert.equal(appExits, failedPort === undefined ? 1 : 0);
    }
});
