// 主窗口（`mainWindow.ts`）：建窗、就绪收尾与启动页的关闭时机。
// 启动页窗口自身的创建与端口分配在 `bootWindows.test.ts`。
import {test} from "node:test";
import {EventEmitter} from "node:events";
import {mockElectron, resetElectronStub} from "../fixtures/electronStub";
import {getTitleBarOverlayOptions} from "./windowControlsOverlay";
import {createResponseHeaderFilter} from "../remote/sessionHeaders";
import {beginGracefulSystemShutdown, getSystemShutdownPorts} from "../startup/systemShutdown";
import {state as runtimeState, resetRuntimeState, SYSTEM_SHUTDOWN_NONE, configureRuntime, paths as runtimePaths} from "../shared/runtime";
import type * as electron from "electron";
import type {App, BrowserWindow as ElectronBrowserWindow, Display, IpcMain, Screen, Session} from "electron";
import type {BootWindow, KernelTarget} from "../shared/types";
import type * as nodeFs from "node:fs";
const assert = require("node:assert/strict");
const path = require("node:path");

// 被测模块在测试内 require：它从 electron 取值，首次加载时必须已经换成替身。
const mainWindowModule = () => require("./mainWindow");

const mainWindowSetup = (t: any) => {
    const timers = new Map();
    const ipcMain = new EventEmitter();
    let windowId = 0;
    class Window extends EventEmitter {
        destroyed?: boolean;

        kernelPort?: number;

        shown?: boolean;

        messages?: unknown[][];

        webContents!: EventEmitter & {
            id: number;
            send: (...args: unknown[]) => void;
            session: {webRequest: {onBeforeSendHeaders(): void; onHeadersReceived(): void}};
        };

        constructor() {
            super();
            this.webContents = Object.assign(new EventEmitter(), {id: ++windowId,
                send: (...args) => { this.messages = [...(this.messages || []), args]; },
                session: {webRequest: {onBeforeSendHeaders() {}, onHeadersReceived() {}}}});
        }
        isDestroyed() { return !!this.destroyed; }
        destroy() { this.destroyed = true; this.emit("closed"); }
        show() { this.shown = true; }
        isMinimized() { return false; }
        setPosition() {}
        unmaximize() {}
    }
    // 平台依赖桩用 satisfies 校验成员名与签名，只实现被测路径访问的部分。
    const appStub = {isReady: () => true, getPreferredSystemLanguages: () => ["en"]} satisfies
        Pick<App, "isReady" | "getPreferredSystemLanguages">;
    // 显示器桩只带被测路径读取的尺寸，其余 Display 成员不参与本用例。
    const displayStub = {size: {width: 1000, height: 800},
        workAreaSize: {width: 1000, height: 800}} as unknown as Display;
    const screenStub = {getPrimaryDisplay: () => displayStub} satisfies Pick<Screen, "getPrimaryDisplay">;
    const processStub = {platform: "win32", argv: []} satisfies Pick<NodeJS.Process, "platform" | "argv">;
    const netStub = {fetch: () => new Promise(() => {})} satisfies Pick<typeof electron.net, "fetch">;
    // readFileSync 有重载，简单桩无法通过 satisfies，注入处再转换。
    const fsStub = {readFileSync: () => "{}"};
    const context = {
        app: appStub,
        getKernelTarget: port => ({port: String(port), mode: "local", ownsKernel: true} as KernelTarget),
        localKernelStartups: new Map(), workspaces: [], bootWindow: undefined,
        kernelPort: "", initializedWindowIds: new Set(),
        getWorkspaceStartupKey: workspace => workspace,
        fs: fsStub,
        path, process: processStub,
        screen: screenStub,
        BrowserWindow: Window, remote: {enable() {}}, bindSpellcheckContextMenu() {}, bindTopBarContextMenu() {},
        getTitleBarOverlayOptions: getTitleBarOverlayOptions,
        rememberWindowKernelTarget() {}, installNavigationPolicy() {}, ipcMain,
        net: netStub,
        setStartupApplicationMenu() {}, isOpenAsHidden: () => false,
        createResponseHeaderFilter: createResponseHeaderFilter,
    };
    // 夹具保持扁平字段，这些字段桥接回共享运行期状态，模块与用例读写同一份数据。
    resetRuntimeState();
    resetElectronStub();
    mockElectron(t, {
        app: appStub as unknown as App,
        BrowserWindow: Window as unknown as typeof ElectronBrowserWindow,
        screen: screenStub as unknown as Record<string, unknown>,
        net: netStub as unknown as Record<string, unknown>,
        ipcMain: ipcMain as unknown as IpcMain,
    });
    const {createMainWindow} = mainWindowModule();
    // 路径与写日志由共享运行期承载，窗口状态文件路径指向测试临时目录下的相对名。
    configureRuntime({...runtimePaths, windowStatePath: "state.json"});
    runtimeState.startup = Object.freeze({...runtimeState.startup, openAsHidden: false});
    Object.defineProperties(context, {
        kernelPort: {
            get: () => runtimeState.kernel.port,
            set: value => { runtimeState.kernel.port = value; },
        },
        localKernelStartups: {get: () => runtimeState.kernel.startups},
        workspaces: {get: () => runtimeState.workspaces},
        bootWindow: {
            get: () => runtimeState.windows.currentBoot,
            set: value => { runtimeState.windows.currentBoot = value; },
        },
        initializedWindowIds: {get: () => runtimeState.windows.initialized},
    });
    const initMainWindow = createMainWindow({
        platform: {
            process: processStub as unknown as Pick<NodeJS.Process, "platform" | "argv">,
            remote: context.remote, fs: fsStub as unknown as Pick<typeof nodeFs, "readFileSync">,
        },
        clock: {
            scheduleTimer: callback => { const key = {}; timers.set(key, callback); return key; },
            cancelTimer: key => timers.delete(key),
        },
        kernel: {getKernelTarget: context.getKernelTarget},
        session: {
            getRemoteSession: () => ({}) as unknown as Session,
            createResponseHeaderFilter: context.createResponseHeaderFilter,
        },
        ui: {
            getTitleBarOverlayOptions: context.getTitleBarOverlayOptions,
            bindSpellcheckContextMenu: context.bindSpellcheckContextMenu,
            bindTopBarContextMenu: context.bindTopBarContextMenu,
            setStartupApplicationMenu: context.setStartupApplicationMenu,
        },
        navigation: {
            setProxy: () => Promise.resolve(),
            installNavigationPolicy: context.installNavigationPolicy,
            getWindowPathname: () => "/stage/build/app/",
        },
        workspace: {
            rememberWindowKernelTarget: context.rememberWindowKernelTarget,
            exitWorkspace: () => {},
            getWorkspaceStartupKey: context.getWorkspaceStartupKey,
            isOpenAsHidden: () => context.isOpenAsHidden(),
        },
    });
    return {context: Object.assign(context, {initMainWindow}), ipcMain, timers, Window};
};

test("main windows close their own boot windows in either frontend readiness order", (t) => {
    for (const first of [0, 1]) {
        const {context, ipcMain, timers, Window} = mainWindowSetup(t);
        const boots = [new Window(), new Window()];
        boots.forEach((window, index) => {
            context.localKernelStartups.set("workspace-" + index, {window, workspace: "workspace-" + index, port: 6806 + index});
            context.initMainWindow(6806 + index);
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

test("main close, tray quit and application quit share the recovery timer", (t: any) => {
    const {context, ipcMain, timers} = mainWindowSetup(t);
    context.initMainWindow(6806);
    const window = context.workspaces[0].browserWindow;
    Object.assign(window.webContents, {isDestroyed: () => false,
        getURL: () => "https://127.0.0.1:6806/stage/build/app/"});
    ipcMain.emit("siyuan-ready-to-show", {sender: window.webContents});
    let prevented = false;
    window.emit("close", {preventDefault: () => { prevented = true; }});
    assert.equal(prevented, true);
    assert.equal(timers.size, 1);
    let menu: electron.MenuItemConstructorOptions[] = [];
    mockElectron(t, {Menu: {buildFromTemplate: template => { menu = template; return {}; }}});
    Object.assign(window, {isVisible: () => true, isAlwaysOnTop: () => false});
    const {resetTrayMenu} = require("./trayMenu") as typeof import("./trayMenu");
    resetTrayMenu({setContextMenu() {}} as unknown as electron.Tray,
        {quit: "quit"}, window);
    const quit = menu.find(item => item.label === "quit");
    assert.ok(quit?.click);
    quit.click({} as electron.MenuItem, {} as ElectronBrowserWindow, {} as electron.KeyboardEvent);
    assert.equal(timers.size, 1);
    assert.deepEqual(window.messages.slice(-2), [["siyuan-save-close", false], ["siyuan-save-close", true]]);
    const {registerAppLifecycle} = require("../startup/appLifecycle") as typeof import("../startup/appLifecycle");
    const appEvents = new EventEmitter();
    mockElectron(t, {app: Object.assign(appEvents, {getPreferredSystemLanguages: () => ["en"]}) as unknown as App});
    registerAppLifecycle({initMainWindow: () => {}, settingsWindowPolicy: () => undefined});
    appEvents.emit("before-quit", {preventDefault() {}});
    assert.equal(timers.size, 1);
    assert.deepEqual(window.messages.at(-1), ["siyuan-save-close", true]);
    window.destroy();
    assert.equal(timers.size, 0);
});

test("main window timeout and closure clean up their own boot windows and readiness listeners", (t) => {
    const {context, ipcMain, timers, Window} = mainWindowSetup(t);
    const boots = [new Window(), new Window()];
    boots.forEach((window, index) => {
        context.localKernelStartups.set("workspace-" + index, {window, workspace: "workspace-" + index, port: 6806 + index});
        context.initMainWindow(6806 + index);
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

test("deep-link startup waits for the interface before showing the window and forwarding the link", (t) => {
    const {context, ipcMain, Window} = mainWindowSetup(t);
    const boot = new Window();
    context.localKernelStartups.set("workspace", {window: boot, workspace: "workspace", port: 6806});
    const url = "siyuan://blocks/20261025000000-abcdefg";
    // 深链由入口解析后写入启动快照，主窗口不再从命令行重新推导。
    runtimeState.startup = Object.freeze({...runtimeState.startup, initialDeepLink: url});
    context.initMainWindow(6806);
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

test("ready hidden startup stays minimized and restores its saved maximized state later", (t) => {
    const {context, ipcMain, Window} = mainWindowSetup(t);
    const boot = new Window();
    context.isOpenAsHidden = () => true;
    context.fs.readFileSync = () => '{"isMaximized":true}';
    context.localKernelStartups.set("workspace", {window: boot, workspace: "workspace", port: 6806});
    context.initMainWindow(6806);
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

test("system shutdown includes every booting workspace and closes only successful exits", async (t) => {
    const savedStartup = runtimeState.startup;
    for (const failedPort of [undefined, 6807]) {
        const {Window} = mainWindowSetup(t);
        const boots = [new Window(), new Window()];
        boots.forEach((window, index) => { window.kernelPort = 6806 + index; });
        let appExits = 0;
        runtimeState.exit.systemShutdown = SYSTEM_SHUTDOWN_NONE;
        runtimeState.exit.gracefulShutdown = undefined;
        runtimeState.exit.keepOpenForShutdown = false;
        runtimeState.workspaces = [];
        runtimeState.windows.bootWindows = new Set(boots) as unknown as Set<BootWindow>;
        runtimeState.startup = Object.freeze({...runtimeState.startup, remoteKernelTarget: undefined});
        assert.deepEqual(getSystemShutdownPorts(), [6806, 6807]);
        beginGracefulSystemShutdown({
            exitApp: () => { appExits++; },
            gracefulExit: async port => port !== failedPort,
        });
        await runtimeState.exit.gracefulShutdown;
        assert.equal(boots[0].destroyed, true);
        assert.equal(!!boots[1].destroyed, failedPort === undefined);
        assert.equal(appExits, failedPort === undefined ? 1 : 0);
    }
    runtimeState.startup = savedStartup;
});
