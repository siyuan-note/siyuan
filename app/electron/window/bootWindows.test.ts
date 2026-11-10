// 启动页窗口（`bootWindows.ts`）：端口分配、窗口创建与加载、app 就绪前的提前准备。
// 主窗口的建窗与首帧收尾在 `mainWindow.test.ts`。
import {test, beforeEach, afterEach} from "node:test";
import {EventEmitter} from "node:events";
import * as runtime from "../shared/runtime";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import type {App, BrowserWindow as ElectronBrowserWindow} from "electron";
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");

// 被测模块在测试内 require：它从 electron 取值，首次加载时必须已经换成替身。
const bootWindows = () => require("./bootWindows");

// 用例固定平台，避免启动页的 Windows 专属不透明度处理受运行机器影响。
const actualPlatform = process.platform;
const actualArgv = process.argv;

type SetupOptions = {
    isDevEnv?: boolean;
    workspaces?: unknown[];
    port?: string | number;
    args?: Record<string, string>;
    createServer?: () => unknown;
    BrowserWindow?: unknown;
    screen?: unknown;
    openAsHidden?: boolean;
};

const setup = (t: any, {
    isDevEnv = false, workspaces = ["workspace"], port = 6806, args = {},
    createServer, BrowserWindow, screen, openAsHidden = false,
}: SetupOptions = {}) => {
    runtime.resetRuntimeState();
    const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-boot-"));
    runtime.configureRuntime({
        appDir: "app", appVer: "3.8.6", confDir,
        windowStatePath: path.join(confDir, "state.json"),
        linuxInputMethodSettingPath: path.join(confDir, "input-method.json"),
        accessibilitySettingPath: path.join(confDir, "accessibility.json"),
        appCrashLogPath: path.join(confDir, "crash.log"),
        appCrashMarkerPath: path.join(confDir, "crash.json"),
        assetsDir: "assets", isDevEnv, simulateRosetta: false,
    });
    runtime.setStartupSnapshot({
        firstOpen: false, openAsHidden,
        lastWorkspacePath: "", lastWorkspaceMissing: false,
        missingWorkspacePath: "", availableWorkspaces: [],
        remoteKernelTarget: undefined, remoteKernelArgError: undefined,
        initialDeepLink: "",
    } as unknown as Parameters<typeof runtime.setStartupSnapshot>[0]);
    runtime.state.workspaces = workspaces as unknown as typeof runtime.state.workspaces;
    runtime.state.kernel.port = port;
    Object.defineProperty(process, "platform", {value: "win32", configurable: true});
    process.argv = [...actualArgv, ...Object.entries(args).map(([name, value]) => name + "=" + value)];

    resetElectronStub();
    const defaultScreen = {
        getPrimaryDisplay: () => ({size: {width: 1000}, workAreaSize: {height: 800}}),
    };
    mockElectron(t, {
        app: {getPreferredSystemLanguages: () => ["en"]} as unknown as App,
        screen: (screen ?? defaultScreen) as unknown as Record<string, unknown>,
        BrowserWindow: (BrowserWindow ?? class {
            static getAllWindows() { return []; }
        }) as unknown as typeof ElectronBrowserWindow,
    });
    t.mock.method(net, "createServer", createServer ?? allocatingServer(7421));
    t.after(() => {
        Object.defineProperty(process, "platform", {value: actualPlatform, configurable: true});
        process.argv = actualArgv;
        fs.rmSync(confDir, {recursive: true, force: true});
    });
    return {boot: bootWindows()};
};

// 默认的端口分配器：单个监听端返回指定端口。
const allocatingServer = (port: number) => () => ({
    on() {},
    listen(_port: number, callback: () => void) { callback(); },
    address: () => ({port}),
    close: (callback: () => void) => callback(),
});

// 启动页窗口假对象：once 把回调挂在自身，loadFile 记录最后一次加载，用例据此断言。
const fakeWindow = (events: unknown[]) => {
    const window: Record<string, any> = {
        isDestroyed: () => false,
        setOpacity: (value: number) => events.push(["opacity", value]),
        once: (name: string, callback: () => void) => { window[name] = callback; },
        on: () => {},
        show: () => events.push("show"),
        minimize: () => events.push("minimize"),
        loadFile: (file: string, options: {query: Record<string, unknown>}) => {
            events.push(["load", options.query.port]);
            window.loaded = {file, query: options.query};
            return Promise.resolve();
        },
    };
    return window;
};

const creatingWindows = (events: unknown[], window: unknown) => class {
    static getAllWindows() { return []; }

    constructor() {
        events.push("create");
        return window as object;
    }
};

beforeEach(() => runtime.resetRuntimeState());
afterEach(() => resetElectronStub());

test("ordinary startup creates synchronously and loads once with the allocated port before showing", async (t) => {
    const events: unknown[] = [];
    const window = fakeWindow(events);
    const {boot} = setup(t, {BrowserWindow: creatingWindows(events, window)});

    const preparedBoot = boot.prepareLocalKernelBoot();
    assert.deepEqual(events, ["create"]);
    assert.equal(await preparedBoot.ready, 7421);
    assert.deepEqual(events, ["create", ["opacity", 0], ["load", 7421]]);

    window["ready-to-show"]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.slice(-2), ["show", ["opacity", 1]]);
});

test("explicit ports and workspace-free development skip allocation", async (t) => {
    const cases: [SetupOptions, string | number][] =
        [[{}, "9000"], [{isDevEnv: true, workspaces: []}, 6806]];
    for (const [options, expected] of cases) {
        const {boot} = setup(t, {...options, createServer: () => assert.fail("unexpected allocation")});
        assert.equal(await boot.getAvailablePort("9000"), expected);
    }
});

test("port allocation failure does not load or show the boot window", async (t) => {
    const events: unknown[] = [];
    const window = fakeWindow(events);
    const {boot} = setup(t, {
        BrowserWindow: creatingWindows(events, window),
        createServer: () => {
            let fail: (error: Error) => void = () => {};
            return {
                on: (name: string, callback: (error: Error) => void) => { fail = callback; },
                listen: () => fail(new Error("port unavailable")),
            };
        },
    });
    const preparedBoot = boot.prepareLocalKernelBoot();
    assert.equal(await preparedBoot.ready, "");
    assert.deepEqual(events, ["create"]);
});

test("hidden startup stays minimized and destroyed windows are not shown", async (t) => {
    const hiddenEvents: unknown[] = [];
    const hiddenWindow = fakeWindow(hiddenEvents);
    const hidden = setup(t, {
        openAsHidden: true, BrowserWindow: creatingWindows(hiddenEvents, hiddenWindow),
    });
    await hidden.boot.prepareLocalKernelBoot().ready;
    assert.deepEqual(hiddenEvents, ["create", ["load", 7421], "minimize"]);

    const destroyedEvents: unknown[] = [];
    const destroyedWindow = fakeWindow(destroyedEvents);
    const destroyed = setup(t, {BrowserWindow: creatingWindows(destroyedEvents, destroyedWindow)});
    const preparedBoot = destroyed.boot.prepareLocalKernelBoot();
    destroyedWindow.isDestroyed = () => true;
    await preparedBoot.ready;
    assert.deepEqual(destroyedEvents, ["create"]);
});

test("concurrent port allocation resolves each request with its own reserved port", async (t) => {
    const close: (() => void)[] = [];
    let nextPort = 7420;
    const {boot} = setup(t, {
        createServer: () => {
            const port = ++nextPort;
            return {
                on() {},
                listen: (_port: number, callback: () => void) => callback(),
                address: () => ({port}),
                close: (callback: () => void) => close.push(callback),
            };
        },
    });
    const first = boot.getAvailablePort();
    const second = boot.getAvailablePort();
    close[1]();
    close[0]();
    assert.deepEqual(await Promise.all([first, second]), [7421, 7422]);
});

test("each boot window can show after another workspace creates its boot window", async (t) => {
    const events: unknown[] = [];
    const window = fakeWindow(events);
    const unrelated = {isDestroyed: () => false, show: () => assert.fail("unrelated window")};
    const {boot} = setup(t, {BrowserWindow: creatingWindows(events, window)});

    // 调用方传入的窗口与共享状态里的“当前启动页”可能不同，显示必须只作用于传入的那个。
    runtime.state.windows.currentBoot = window as unknown as typeof runtime.state.windows.currentBoot;
    boot.showLocalBootWindow(window, 6806, "en");
    runtime.state.windows.currentBoot = unrelated as unknown as typeof runtime.state.windows.currentBoot;
    window["ready-to-show"]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events.slice(-2), ["show", ["opacity", 1]]);
});

test("appearance recovery reloads only the affected boot window with its original connection", (t) => {
    class Window extends EventEmitter {
        destroyed = false;

        // loadFile 的入参记录，用例据此断言重新加载时沿用了原始连接。
        loaded?: {file: string; query: Record<string, unknown>};

        static getAllWindows() { return []; }

        isDestroyed() { return this.destroyed; }

        destroy() { this.destroyed = true; this.emit("closed"); }

        loadFile(file: string, options: {query: Record<string, unknown>}) {
            this.loaded = {file, query: options.query};
            return Promise.resolve();
        }
    }
    setup(t, {BrowserWindow: Window});
    const {createBootWindow, loadBootWindow} = bootWindows();
    const a = createBootWindow() as any;
    loadBootWindow({window: a, port: 6806, lang: "en"});
    const b = createBootWindow() as any;
    loadBootWindow({window: b, port: 6807, lang: "ja"});
    a.emit("unresponsive");
    // 启动页由静态资源目录定位，不依赖模块所在层级。
    assert.equal(a.loaded.file, path.join("assets", "boot.html"));
    assert.equal(a.loaded.query.port, 6806);
    assert.equal(a.loaded.query.lang, "en");
    assert.equal(a.loaded.query.appearance, "0");
    assert.equal(b.loaded.query.port, 6807);
    assert.equal(b.loaded.query.lang, "ja");
    assert.equal(b.loaded.query.appearance, undefined);
    a.destroy();
    assert.deepEqual(Array.from(runtime.state.windows.bootWindows), [b]);
});
