const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const {test} = require("node:test");
const {readFileSync} = require("node:fs");
const {runInNewContext} = require("node:vm");
const {captureWindowGeometry, normalizeWindowGeometry, restoreWindowGeometry} = require("./windowGeometry");

const state = (values = {}) => ({version: 1, x: 100, y: 80, width: 900, height: 700,
    maximized: false, fullscreen: false, ...values});
const display = {workArea: {x: 0, y: 0, width: 1920, height: 1040}};
const screen = {getDisplayMatching: () => display, getAllDisplays: () => [display]};
const fixture = (initial = state()) => {
    const window = new EventEmitter();
    const calls = [];
    Object.assign(window, {
        isDestroyed: () => false,
        isMaximized: () => initial.maximized,
        isFullScreen: () => initial.fullscreen,
        isMinimized: () => false,
        getNormalBounds: () => ({x: initial.x, y: initial.y, width: initial.width, height: initial.height}),
        unmaximize: () => calls.push("unmaximize"),
        maximize: () => calls.push("maximize"),
        setBounds: bounds => calls.push(bounds),
        setFullScreen: value => {
            calls.push(["fullscreen", value]);
            initial.fullscreen = value;
        },
    });
    return {window, calls};
};

test("最大化窗口保存普通窗口边界和状态", () => {
    const saved = state({maximized: true});
    assert.deepEqual(captureWindowGeometry(fixture(saved).window), saved);
});

test("负坐标显示器上的布局保持原大小和位置", () => {
    const saved = state({x: -1500, y: 80});
    assert.deepEqual(normalizeWindowGeometry(saved, {
        getDisplayMatching: () => ({workArea: {x: -1920, y: 0, width: 1920, height: 1080}}),
        getAllDisplays: () => [{workArea: {x: -1920, y: 0, width: 1920, height: 1080}}],
    }), {x: -1500, y: 80, width: 900, height: 700});
});

test("跨屏窗口保留原位置和超过单个显示器的宽度", () => {
    const right = {workArea: {x: 1920, y: 0, width: 1920, height: 1040}};
    const screens = {getAllDisplays: () => [display, right], getDisplayMatching: () => right};
    for (const bounds of [{x: 1600, y: 100, width: 1000, height: 700}, {x: 800, y: 100, width: 2800, height: 700}]) {
        assert.deepEqual(normalizeWindowGeometry(state(bounds), screens), bounds);
    }
});

test("部分移出屏幕但标题栏仍可操作时保留边界", () => {
    const bounds = {x: -100, y: 100, width: 900, height: 1100};
    assert.deepEqual(normalizeWindowGeometry(state(bounds), screen), bounds);
});

test("仅内容可见或标题栏可见区域过小时移回工作区", () => {
    for (const bounds of [{x: 100, y: -100, width: 900, height: 700}, {x: 1900, y: 100, width: 900, height: 700}]) {
        const restored = normalizeWindowGeometry(state(bounds), screen);
        assert.ok(restored.x >= 0 && restored.y >= 0);
        assert.ok(restored.x + restored.width <= display.workArea.width);
        assert.ok(restored.y + restored.height <= display.workArea.height);
    }
});

test("移除显示器或缩小工作区后窗口保持可见并遵守最小尺寸", () => {
    assert.deepEqual(normalizeWindowGeometry(state({x: 5000, y: -2000, width: 3000, height: 2000}), screen),
        {x: 0, y: 0, width: 1920, height: 1040});
    assert.deepEqual(normalizeWindowGeometry(state({width: 10, height: 20}), screen),
        {x: 100, y: 80, width: 493, height: 376});
});

test("缺失、未知版本和非法窗口信息不改变窗口", async () => {
    for (const saved of [undefined, null, {}, state({version: 2}), state({width: -1}),
        state({x: Infinity}), state({height: 1.5}), state({maximized: "true"})]) {
        const f = fixture();
        assert.equal(await restoreWindowGeometry(f.window, saved, screen), false);
        assert.deepEqual(f.calls, []);
    }
});

test("先取消最大化并恢复边界，再按保存状态最大化", async () => {
    const f = fixture(state({maximized: true}));
    assert.equal(await restoreWindowGeometry(f.window, state({maximized: true}), screen), true);
    assert.deepEqual(f.calls, ["unmaximize", {x: 100, y: 80, width: 900, height: 700}, "maximize"]);
});

test("异步退出全屏后才恢复边界和全屏状态", async () => {
    const f = fixture(state({fullscreen: true}));
    let fullscreen = true;
    f.window.isFullScreen = () => fullscreen;
    f.window.setFullScreen = value => f.calls.push(["fullscreen", value]);
    const restored = restoreWindowGeometry(f.window, state({fullscreen: true}), screen);
    assert.deepEqual(f.calls, [["fullscreen", false]]);
    fullscreen = false;
    f.window.emit("leave-full-screen");
    assert.equal(await restored, true);
    assert.deepEqual(f.calls, [["fullscreen", false], {x: 100, y: 80, width: 900, height: 700}, ["fullscreen", true]]);
    assert.equal(f.window.listenerCount("leave-full-screen"), 0);
});

const openWindow = windowGeometry => {
    const source = readFileSync("electron/main.js", "utf8");
    const start = source.indexOf('ipcMain.on("siyuan-open-window",');
    const end = source.indexOf('ipcMain.on("siyuan-open-workspace",', start);
    const calls = [];
    const timers = new Set();
    const ipcMain = new EventEmitter();
    const pendingWindowIds = new Set();
    let options;
    const windows = [];
    let pathname = "/stage/build/app/window.html";
    class Window extends EventEmitter {
        static getFocusedWindow() {
            return {getBounds: () => ({x: 0, y: 0})};
        }
        constructor(value) {
            super();
            options = value;
            windows.push(this);
            this.destroyed = false;
            this.webContents = Object.assign(new EventEmitter(), {id: 2,
                session: {setSpellCheckerLanguages: () => {}},
                setBackgroundThrottling: value => calls.push(["throttling", value]),
            });
        }
        center() { calls.push("center"); }
        setPosition(x, y) { calls.push({x, y}); }
        setBounds(bounds) { calls.push(bounds); }
        maximize() { calls.push("maximize"); }
        setFullScreen() { calls.push("fullscreen"); }
        setAlwaysOnTop() {}
        loadURL() {}
        isDestroyed() { return this.destroyed; }
    }
    const workArea = {x: 1920, y: 0, width: 1280, height: 1000};
    runInNewContext(source.slice(start, end), {
        ipcMain, pendingWindowIds,
        BrowserWindow: Window, URL, process: {platform: "win32"},
        getWindowKernelTarget: () => ({origin: "http://127.0.0.1:6806", mode: "local"}),
        windowWorkspaces: {get: () => windows[0], associate: () => {}},
        screen: {
            ...screen,
            getDisplayNearestPoint: point => point.x === 2000 ? {id: 2, workArea} : {id: 1, size: {width: 1920, height: 1080}},
            getCursorScreenPoint: () => ({x: 2000, y: 20}),
        },
        normalizeWindowGeometry, path: {join: () => "icon"}, appDir: "", appVer: "test",
        remote: {enable: () => {}}, bindSpellcheckContextMenu: () => {}, rememberWindowKernelTarget: () => {},
        windowNavigate: () => {},
        showWindow: () => calls.push("show"), getWindowPathname: () => pathname, writeLog: () => {},
        setTimeout: callback => { timers.add(callback); return callback; },
        clearTimeout: timer => timers.delete(timer),
    });
    const open = () => ipcMain.emit("siyuan-open-window", {sender: {id: 1}}, {
        url: "http://127.0.0.1:6806/stage/build/app/window.html?windowWorkspace=20260924100000-abcdefg",
        windowGeometry,
    });
    open();
    const win = windows[0];
    return {options, calls, workArea, win, ipcMain, timers, pendingWindowIds, open,
        navigate: value => { pathname = value; win.webContents.emit("did-finish-load"); },
        ready: () => ipcMain.emit("siyuan-window-ready", {sender: win.webContents}),
    };
};

test("新窗口创建时使用保存边界，不被鼠标所在显示器覆盖", () => {
    const f = openWindow(state({maximized: true}));
    assert.deepEqual([f.options.x, f.options.y, f.options.width, f.options.height], [100, 80, 900, 700]);
    assert.deepEqual(f.calls, []);
    f.win.emit("ready-to-show");
    f.ready();
    assert.deepEqual(f.calls, ["maximize", "show", ["throttling", true]]);
});

test("旧窗口布局继续使用默认窗口位置", () => {
    const f = openWindow(undefined);
    assert.deepEqual(f.calls, ["center", f.workArea]);
});

for (const rendererFirst of [true, false]) {
    test(`新窗口等待自身内容和原生绘制就绪：rendererFirst=${rendererFirst}`, () => {
        const f = openWindow(state());
        assert.equal(f.options.show, false);
        assert.equal(f.options.webPreferences.backgroundThrottling, false);
        f.ipcMain.emit("siyuan-window-ready", {sender: {id: 99}});
        f.navigate("/stage/build/app/window.html");
        f.open();
        assert.deepEqual(f.calls, []);
        if (rendererFirst) f.ready();
        else f.win.emit("ready-to-show");
        assert.deepEqual(f.calls, []);
        f.open();
        assert.deepEqual(f.calls, []);
        if (rendererFirst) f.win.emit("ready-to-show");
        else f.ready();
        assert.deepEqual(f.calls, ["show", ["throttling", true]]);
        assert.equal(f.timers.size, 0);
        assert.equal(f.ipcMain.listenerCount("siyuan-window-ready"), 0);
        assert.equal(f.pendingWindowIds.size, 0);
        f.ready();
        f.win.emit("ready-to-show");
        assert.deepEqual(f.calls, ["show", ["throttling", true]]);
        f.open();
        assert.equal(f.calls.at(-1), "show");
    });
}

test("全屏窗口也等到内容绘制完成再恢复状态", () => {
    const f = openWindow(state({fullscreen: true}));
    assert.deepEqual(f.calls, []);
    f.ready();
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["fullscreen", "show", ["throttling", true]]);
});

test("跳转到认证页面后等待原生绘制完成并显示", () => {
    const f = openWindow(state());
    f.navigate("/check-auth");
    assert.deepEqual(f.calls, []);
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["show", ["throttling", true]]);
});

test("初始化超时可显示窗口，关闭窗口会清理等待资源", () => {
    const f = openWindow(state());
    [...f.timers][0]();
    assert.deepEqual(f.calls, ["show", ["throttling", true]]);
    assert.equal(f.ipcMain.listenerCount("siyuan-window-ready"), 0);
    const closed = openWindow(state());
    const timeout = [...closed.timers][0];
    closed.win.destroyed = true;
    closed.win.emit("closed");
    closed.ready();
    closed.win.emit("ready-to-show");
    timeout();
    assert.deepEqual(closed.calls, []);
    assert.equal(closed.timers.size, 0);
    assert.equal(closed.ipcMain.listenerCount("siyuan-window-ready"), 0);
    assert.equal(closed.pendingWindowIds.size, 0);
});
