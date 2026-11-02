// 独立文档窗口（`openWindow.ts`）：地址校验、外观回落、几何恢复与显示时机。
// 几何数据的校验与规范化在 `windowGeometry.test.ts`。
import {EventEmitter} from "node:events";
import {test} from "node:test";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {BrowserWindow as ElectronBrowserWindow, Display, Screen, Session} from "electron";
import type {KernelTarget} from "../shared/types";
import {getTitleBarOverlayOptions, getCaptionHeight} from "./windowControlsOverlay";
import {normalizeWindowGeometry} from "./windowGeometry";
const assert = require("node:assert/strict");

const state = (values = {}) => ({version: 1, x: 100, y: 80, width: 900, height: 700,
    maximized: false, fullscreen: false, ...values});
// @electron/remote 在加载时访问 Electron 原生绑定，同一条用例只能建立一次模块替身。
const remoteBound = new WeakSet<object>();
const display = {workArea: {x: 0, y: 0, width: 1920, height: 1040}};
const screen = {getDisplayMatching: () => display, getAllDisplays: () => [display]};

const openWindow = (t: any, windowGeometry, appearance = {}, mode: KernelTarget["mode"] = "local") => {
    const calls = [];
    const timers = new Set<() => void>();
    const initializedWindowIds = new Set();
    let options;
    let url;
    const windows = [];
    let pathname = "/stage/build/app/window.html";
    class Window extends EventEmitter {
        destroyed = false;

        webContents!: EventEmitter & {
            id: number;
            session: {setSpellCheckerLanguages: () => void};
            send: (value: unknown) => void;
        };

        static getFocusedWindow() {
            return {getBounds: () => ({x: 0, y: 0})};
        }
        constructor(value) {
            super();
            options = value;
            windows.push(this);
            this.webContents = Object.assign(new EventEmitter(), {id: 2,
                session: {setSpellCheckerLanguages: () => {}},
                send: value => calls.push(value),
            });
        }
        center() { calls.push("center"); }
        setPosition(x, y) { calls.push({x, y}); }
        setBounds(bounds) { calls.push(bounds); }
        maximize() { calls.push("maximize"); }
        setFullScreen() { calls.push("fullscreen"); }
        setAlwaysOnTop() {}
        loadURL(value) { url = value; }
        isDestroyed() { return this.destroyed; }
        destroy() { this.destroyed = true; calls.push("destroy"); }
    }
    const workArea = {x: 1920, y: 0, width: 1280, height: 1000};
    const screenStub = {
        ...screen,
        getDisplayNearestPoint: point => (point.x === 2000 ? {id: 2, workArea} :
            {id: 1, size: {width: 1920, height: 1080}}) as unknown as Display,
        getCursorScreenPoint: () => ({x: 2000, y: 20}),
    } as unknown as Screen;
    resetElectronStub();
    mockElectron(t, {
        BrowserWindow: Window as unknown as typeof ElectronBrowserWindow,
        screen: screenStub as unknown as Record<string, unknown>,
    });
    t.after(resetElectronStub);
    if (!remoteBound.has(t)) {
        remoteBound.add(t);
        t.mock.module("@electron/remote/main", {exports: {enable() {}}});
    }
    const {createOpenWindowHandler} = require("./openWindow");
    const handle = createOpenWindowHandler({
        isWindowInitialized: id => initializedWindowIds.has(id),
        process: {platform: "win32"}, appVer: "test",
        writeLog: () => {}, setTimeout: callback => { timers.add(callback); return callback; },
        clearTimeout: (timer: () => void) => { timers.delete(timer); },
        getWindowKernelTarget: (): KernelTarget =>
            ({origin: "http://127.0.0.1:6806", mode, ownsKernel: true, port: "6806"}),
        getWindowPathname: () => pathname,
        getRemoteSession: () => ({}) as unknown as Session,
        // OpenWindowOptions 未导出，这里用 never 绕过对注入参数的类型检查。
        windowWorkspaces: {get: () => windows[0], associate: () => {}} as never,
        showWindow: () => calls.push("show"), installNavigationPolicy: () => {},
        markExpectedRendererExit: () => calls.push("expected-exit"),
        rememberWindowKernelTarget: () => {}, bindSpellcheckContextMenu: () => {},
        getCaptionHeight: (compact, panel) => getCaptionHeight(compact, panel),
        getTitleBarOverlayOptions: (platform, height) => getTitleBarOverlayOptions(platform, height),
        normalizeWindowGeometry,
    });
    const open = () => handle({sender: {id: 1}}, {
        url: "http://127.0.0.1:6806/stage/build/app/window.html?windowWorkspace=20260924100000-abcdefg",
        windowGeometry,
        ...appearance,
    });
    open();
    const win = windows[0];
    return {options, calls, workArea, win, initializedWindowIds, url, open, timers,
        navigate: value => { pathname = value; },
        close: () => win.emit("close", {preventDefault: () => calls.push("prevent-close")}),
    };
};

test("新窗口创建时使用保存边界，不被鼠标所在显示器覆盖", (t) => {
    const f = openWindow(t, state({maximized: true}));
    assert.deepEqual([f.options.x, f.options.y, f.options.width, f.options.height], [100, 80, 900, 700]);
    // 首帧绘制（或短延迟）前不显示窗口，最大化也在那时才应用
    assert.equal(f.options.show, false);
    // 独立文档窗口首帧按面板高度预留窗口按钮区，不落到系统的默认标题栏高度
    assert.equal(f.options.titleBarOverlay.height, 42);
    assert.deepEqual(f.calls, []);
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["maximize", "show"]);
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["maximize", "show"]);
});

test("旧窗口布局继续使用默认窗口位置", (t) => {
    const f = openWindow(t, undefined);
    assert.deepEqual(f.calls, ["center", f.workArea]);
});

// 独立文档窗口的首帧按钮区跟随界面密度，避免加载完成后再纠正一次高度。
test("新窗口首帧按钮区跟随界面密度", (t) => {
    assert.equal(openWindow(t, state()).options.titleBarOverlay.height, 42);
    assert.equal(openWindow(t, state(), {compactMode: true}).options.titleBarOverlay.height, 34);
    assert.equal(openWindow(t, state(), {compactMode: false}).options.titleBarOverlay.height, 42);
    assert.equal(openWindow(t, state(), {compactMode: "true"}).options.titleBarOverlay.height, 42,
        "非布尔输入按舒适密度处理");
});

test("新窗口首帧后显示，定时器先到也显示，重复打开激活已有窗口", (t) => {
    const f = openWindow(t, state());
    assert.equal(f.options.show, false);
    assert.equal(f.options.webPreferences.backgroundThrottling, undefined);
    assert.deepEqual(f.calls, []);
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["show"]);
    assert.equal(f.timers.size, 1, "ready-to-show 已显示，只保留兜底超时");
    f.open();
    assert.deepEqual(f.calls, ["show", "show"]);

    // 首帧迟迟不来时由短延迟定时器显示，且不会重复显示
    const timer = openWindow(t, state());
    assert.equal(timer.timers.size, 2);
    assert.ok([...timer.timers].some(fn => {
        if (fn.name !== "revealWindow") return false;
        fn();
        return true;
    }), "存在短延迟显示定时器");
    assert.deepEqual(timer.calls, ["show"]);
    timer.win.emit("ready-to-show");
    assert.deepEqual(timer.calls, ["show"]);
});

test("全屏窗口首帧后恢复状态", (t) => {
    const f = openWindow(t, state({fullscreen: true}));
    assert.deepEqual(f.calls, []);
    f.win.emit("ready-to-show");
    assert.deepEqual(f.calls, ["fullscreen", "show"]);
});

test("原生窗口和页面使用同一实际主题颜色，非法颜色使用安全默认值", (t) => {
    for (const appearance of [
        {themeMode: "dark", backgroundColor: "#234567", foregroundColor: "#abcdef"},
        {themeMode: "light", backgroundColor: "#f0e8d8", foregroundColor: "#345678"},
        {themeMode: "dark", backgroundColor: "transparent", foregroundColor: "red;}"},
        {},
    ]) {
        const f = openWindow(t, state(), appearance);
        const dark = appearance.themeMode === "dark";
        const background = appearance.backgroundColor?.startsWith("#") ? appearance.backgroundColor : dark ? "#1e1e1e" : "#ffffff";
        const foreground = appearance.foregroundColor?.startsWith("#") ? appearance.foregroundColor : dark ? "#d4d4d4" : "#222222";
        assert.equal(f.options.backgroundColor, background);
        const params = new URL(f.url).searchParams;
        assert.equal(params.get("windowBackground"), background);
        assert.equal(params.get("windowForeground"), foreground);
        assert.equal(params.get("windowThemeMode"), dark ? "dark" : "light");
    }
});
