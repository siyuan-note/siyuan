import * as devToolsDock from "./devToolsDock";
import * as nodeProcess from "node:process";
import * as nodeFs from "node:fs";
import * as electron from "electron";
import {Channel} from "../shared/channels";
import {appIconPath, desktopUserAgent, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH} from "../shared/desktopDefaults";
import {requireElectronRemote} from "../shared/electronRemote";
import * as runtime from "../shared/runtime";
import * as kernelEndpoint from "../kernel/kernelEndpoint";
import * as connectionManager from "../remote/connectionManager";
import * as windowOverlay from "./windowControlsOverlay";
import {APP_PAGE, CHECK_AUTH_PAGE} from "../shared/pagePaths";
import {kernelWindowPreferences} from "./windowPreferences";
import {rememberWindowKernelTarget as rememberKernelTargetForWindow} from "./windowLifecycle";
import {addWorkspace, getCurrentBootWindow, isWindowInitialized} from "./windowRegistry";
import * as sessionHeaders from "../remote/sessionHeaders";
import * as language from "../shared/language";
import * as appExit from "./appExit";
import * as contextMenu from "./contextMenu";
import * as windowNavigation from "./windowNavigation";
import * as appMenu from "./appMenu";
import * as previousKernelExit from "../kernel/previousKernelExit";
import {installWindowCloseRecovery, requestWindowClose} from "./closeRecovery";
import {createRefererFilter} from "./refererFilter";
import type {
    BrowserWindow,
    Event as ElectronEvent,
    IpcMainEvent,
    OnHeadersReceivedListenerDetails,
    Rectangle,
    Screen,
    Session,
    TitleBarOverlay,
    WebContents,
} from "electron";
import type {KernelTarget, LogFunction, Workspace} from "../shared/types";

type MainWindowNetResponse = {data: {proxy: {scheme: string; host: string; port: string | number}}};

type MainWindowState = {
    isMaximized?: boolean;
    isDevToolsOpened?: boolean;
    fullscreen?: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
};

/** 主屏尺寸与可用区域；读取失败时默认尺寸为 0 且没有可用区域。 */
type MainWindowDisplay = {defaultWidth: number; defaultHeight: number; workArea?: Rectangle};

/** 修正后的窗口状态与位置。resetToCenter 表示保存的位置已不可用。 */
type ResolvedWindowState = {state: MainWindowState; x: number; y: number; resetToCenter: boolean};

/** 主窗口的启动条件：内核目标、覆盖在其上的启动页与待登记的工作空间目录。 */
type MainWindowLaunch = {
    kernelTarget: KernelTarget;
    /** 本机内核的启动页窗口；远端内核与无启动记录时为 undefined。 */
    bootWindow: BrowserWindow | undefined;
    /** 本次启动对应的窗口工作空间目录，登记进账本后清除启动记录。 */
    pendingWorkspaceDir: string | undefined;
};

const readSavedWindowState = (file: string,
    windowFs: Pick<typeof nodeFs, "readFileSync">,
    log: LogFunction): Partial<MainWindowState> => {
    try {
        return JSON.parse(windowFs.readFileSync(file, "utf8"));
    } catch (error) {
        log("read window state failed: " + error);
        return {};
    }
};

const readDisplayMetrics = (windowScreen: Screen, log: LogFunction): MainWindowDisplay => {
    try {
        const display = windowScreen.getPrimaryDisplay();
        return {
            defaultWidth: Math.floor(display.size.width * 0.8),
            defaultHeight: Math.floor(display.workAreaSize.height * 0.8),
            workArea: display.workArea,
        };
    } catch (error) {
        log("get screen size failed: " + error);
        return {defaultWidth: 0, defaultHeight: 0};
    }
};

// 依据主屏尺寸修正上次保存的窗口矩形：负数偏移、越界位置与超尺寸都回落到可用值。
const resolveWindowState = (saved: Partial<MainWindowState>, display: MainWindowDisplay,
    log: LogFunction): ResolvedWindowState => {
    const {defaultWidth, defaultHeight, workArea} = display;
    const state: MainWindowState = {
        isMaximized: saved.isMaximized ?? false,
        fullscreen: saved.fullscreen ?? false,
        isDevToolsOpened: saved.isDevToolsOpened ?? false,
        x: saved.x ?? 0,
        y: saved.y ?? 0,
        width: saved.width ?? defaultWidth,
        height: saved.height ?? defaultHeight,
    };

    log("window stat [x=" + state.x + ", y=" + state.y + ", width=" + state.width + ", height=" + state.height + ", isMaximized=" + state.isMaximized + "], " +
        "default [x=0, y=0, width=" + defaultWidth + ", height=" + defaultHeight + "], " +
        "old [x=" + saved.x + ", y=" + saved.y + ", width=" + saved.width + ", height=" + saved.height + ", isMaximized=" + saved.isMaximized + "]");

    let resetToCenter = false;
    let x = state.x;
    if (-32 < x && 0 > x) {
        x = 0;
    }
    let y = state.y;
    if (-32 < y && 0 > y) {
        y = 0;
    }
    if (workArea) {
        // 窗口大于 workArea 时缩小会隐藏到左下角，这里使用最小值重置。
        // 真实尺寸可能比 workArea 大几个像素，因此留出容差，否则会被误判为需要恢复默认尺寸。
        // https://github.com/siyuan-note/siyuan/issues/7755 https://github.com/siyuan-note/siyuan/issues/13732
        if (state.width > workArea.width + 32 || state.height > workArea.height + 32) {
            state.width = Math.min(defaultWidth, workArea.width);
            state.height = Math.min(defaultHeight, workArea.height);
            log("reset window size [width=" + state.width + ", height=" + state.height + "]");
        }

        if (x >= workArea.width * 0.8 || y >= workArea.height * 0.8) {
            resetToCenter = true;
            log("reset window to center cause x or y >= 80% of workArea");
        }
    }

    if (x < 0 || y < 0) {
        resetToCenter = true;
        log("reset window to center cause x or y < 0");
    }

    if (state.width < MIN_WINDOW_WIDTH) {
        state.width = MIN_WINDOW_WIDTH;
        log("reset window width [" + MIN_WINDOW_WIDTH + "]");
    }
    if (state.height < MIN_WINDOW_HEIGHT) {
        state.height = MIN_WINDOW_HEIGHT;
        log("reset window height [" + MIN_WINDOW_HEIGHT + "]");
    }

    return {state, x, y, resetToCenter};
};

/** 加载主界面所需的协作者。远端内核直接加载，本机内核先应用代理再加载。 */
type MainContentOptions = {
    window: BrowserWindow;
    target: KernelTarget;
    /** 远端内核已完成认证；未认证时先进 /check-auth。 */
    remoteAuthenticated: boolean;
    getServer: (port: string | number) => string;
    fetchNetwork: (url: string, init: {method: string}) => Promise<{json: () => Promise<MainWindowNetResponse>}>;
    setProxy: (rules: string, contents: WebContents, mode: string) => unknown;
    scheduleTimer: (callback: () => void, ms: number) => unknown;
    resolveLanguage: () => string;
    log: LogFunction;
};

// setProxy 用超时兜底包装：Electron 在某些系统代理配置下 session.setProxy 可能永久 pending
// （既不 resolve 也不 reject），会让 loadURL 永不执行、主窗口卡在启动页。
const loadMainContent = ({
    window: currentWindow, target, remoteAuthenticated, getServer, fetchNetwork, setProxy, scheduleTimer,
    resolveLanguage, log,
}: MainContentOptions): void => {
    const loadMainURL = () => {
        const appURL = new URL(APP_PAGE, target.origin);
        appURL.searchParams.set("v", Date.now().toString());
        if (target.mode === "remote") {
            appURL.searchParams.set("remote", "1");
        }
        if (target.mode === "remote" && !remoteAuthenticated) {
            const authURL = new URL(CHECK_AUTH_PAGE, target.origin);
            authURL.searchParams.set("to", appURL.pathname + appURL.search);
            authURL.searchParams.set("lang", resolveLanguage());
            authURL.searchParams.set("remote", "1");
            currentWindow.loadURL(authURL.href);
        } else {
            currentWindow.loadURL(appURL.href);
        }
    };
    if (target.mode === "remote") {
        loadMainURL();
        return;
    }
    fetchNetwork(getServer(target.port) + "/api/system/getNetwork", {method: "POST"}).then((response) => {
        return response.json();
    }).then((response: MainWindowNetResponse) => {
        const proxy = response.data.proxy;
        const proxyMode = proxy.scheme === "system" ? "system" : proxy.scheme === "" ? "direct" : "fixed_servers";
        const setProxyDone = setProxy(`${proxy.scheme}://${proxy.host}:${proxy.port}`,
            currentWindow.webContents, proxyMode);
        Promise.race([
            Promise.resolve(setProxyDone),
            new Promise<void>((resolve) => scheduleTimer(() => resolve(), 5000)), // setProxy 永久 pending 时的超时兜底
        ]).then(loadMainURL).catch(() => {
            log("setProxy failed, load main UI without proxy");
            loadMainURL();
        });
    }).catch((error: Error) => {
        // getNetwork 失败也要继续加载主界面，避免主窗口不加载导致卡在启动页
        log("getNetwork failed, load main UI without proxy: " + error.message);
        loadMainURL();
    });
};

/** 主窗口就绪收尾所需的协作者。 */
type MainWindowReadyOptions = {
    window: BrowserWindow;
    /** 主窗口显示前一直覆盖在其上的启动页。 */
    bootWindow: BrowserWindow | undefined;
    windowState: MainWindowState;
    isOpenAsHidden: () => boolean;
    scheduleTimer: (callback: () => void, ms: number) => unknown;
    cancelTimer: (timer: unknown) => void;
    log: LogFunction;
    onReady?: () => void;
};

// 前端初始化完成后显示主窗口并关闭启动页；siyuan-ready-to-show 迟迟不发时，
// 由超时兜底强制销毁启动页并显示主窗口，避免永久停留在启动页。
const attachMainWindowReady = ({
    window: currentWindow, bootWindow, windowState, isOpenAsHidden,
    scheduleTimer, cancelTimer, log, onReady,
}: MainWindowReadyOptions): void => {
    const {ipcMain} = electron;
    const readyToShowTimeout = scheduleTimer(() => {
        ipcMain.removeListener(Channel.SIYUAN_READY_TO_SHOW, readyToShow);
        if (bootWindow && !bootWindow.isDestroyed()) {
            if (!currentWindow.isDestroyed()) {
                log("siyuan-ready-to-show timeout, force showing main window");
                currentWindow.show();
            }
            bootWindow.destroy();
        }
    }, 60000);
    const readyToShow = (event: IpcMainEvent): void => {
        if (event.sender !== currentWindow.webContents) return;
        ipcMain.removeListener(Channel.SIYUAN_READY_TO_SHOW, readyToShow);
        cancelTimer(readyToShowTimeout); // 正常收到信号则取消超时兜底
        if (isOpenAsHidden()) {
            if (windowState.isMaximized) {
                // 隐藏启动时延迟到首次还原再最大化，避免最大化操作提前显示窗口。
                currentWindow.once("restore", () => {
                    currentWindow.maximize();
                });
            }
            currentWindow.minimize();
        } else {
            currentWindow.show();
            if (windowState.isMaximized) {
                currentWindow.maximize();
            } else {
                currentWindow.unmaximize();
            }
            if (windowState.isDevToolsOpened) {
                devToolsDock.openDevTools(currentWindow.webContents); // 保证开发者工具窗口在前
            }
        }
        if (bootWindow && !bootWindow.isDestroyed()) {
            bootWindow.destroy();
        }
        onReady?.();
    };
    ipcMain.on(Channel.SIYUAN_READY_TO_SHOW, readyToShow);
    currentWindow.once("closed", () => {
        cancelTimer(readyToShowTimeout);
        ipcMain.removeListener(Channel.SIYUAN_READY_TO_SHOW, readyToShow);
        if (bootWindow && !bootWindow.isDestroyed()) bootWindow.destroy();
    });
};

// 主窗口创建用到的内建依赖，签名从真实模块派生；只声明实际调用的方法。
type MainWindowPlatform = {
    process?: Pick<NodeJS.Process, "platform" | "argv">;
    remote?: {enable: (contents: WebContents) => void};
    fs?: Pick<typeof nodeFs, "readFileSync">;
};

// 全部注入项都是测试接缝：每项默认取真实实现，生产不传即行为不变。
type MainWindowOptions = {
    platform?: MainWindowPlatform;
    /** 计时器：虚拟时间测试整体替换。 */
    clock?: {
        scheduleTimer?: (callback: () => void, ms: number) => unknown;
        cancelTimer?: (timer: unknown) => void;
    };
    kernel?: {
        getKernelTarget?: (target: string | number | KernelTarget) => KernelTarget;
    };
    session?: {
        getRemoteSession?: (target: KernelTarget) => Session;
        createResponseHeaderFilter?: (target: KernelTarget) => (details: OnHeadersReceivedListenerDetails,
            callback: (response: {responseHeaders: Record<string, string[]>}) => void) => void;
    };
    ui?: {
        getTitleBarOverlayOptions?: (platform?: NodeJS.Platform, height?: number) => TitleBarOverlay | false;
        bindSpellcheckContextMenu?: (contents: WebContents) => void;
        bindTopBarContextMenu?: (window: BrowserWindow) => void;
        setStartupApplicationMenu?: () => void;
    };
    navigation?: {
        setProxy?: (rules: string, contents: WebContents, mode: string) => unknown;
        installNavigationPolicy?: (window: BrowserWindow, kind: string, target: KernelTarget) => void;
        getWindowPathname?: (window: BrowserWindow) => string;
    };
    workspace?: {
        rememberWindowKernelTarget?: (window: BrowserWindow, target: KernelTarget) => void;
        exitWorkspace?: (workspace: Workspace | undefined) => void;
        getWorkspaceStartupKey?: (workspace: string) => string;
        isOpenAsHidden?: () => boolean;
    };
};

// 本地内核窗口由启动页接管；远端内核没有启动记录，启动页即当前窗口。
const resolveMainWindowLaunch = (kernel: string | number | KernelTarget,
    getKernelTarget: (target: string | number | KernelTarget) => KernelTarget): MainWindowLaunch => {
    const kernelTarget = getKernelTarget(kernel);
    const currentKernelPort = kernelTarget.port.toString();
    const startup = kernelTarget.mode === "remote" ? undefined :
        Array.from(runtime.state.kernel.startups.values())
            .find(item => item.port?.toString() === currentKernelPort);
    return {
        kernelTarget,
        bootWindow: startup ? startup.window :
            (kernelTarget.mode === "remote" ? getCurrentBootWindow() : undefined),
        pendingWorkspaceDir: startup?.workspace,
    };
};

// 远端未认证时先载入认证页，该页加载完成才显示窗口并关闭启动页。
const installCheckAuthReveal = (currentWindow: BrowserWindow, {kernelTarget, bootWindow}: MainWindowLaunch,
    getWindowPathname: (window: BrowserWindow) => string): void => {
    currentWindow.webContents.on("did-finish-load", () => {
        if (kernelTarget.mode !== "remote") {
            return;
        }
        if (getWindowPathname(currentWindow) === CHECK_AUTH_PAGE) {
            currentWindow.show();
            if (bootWindow && !bootWindow.isDestroyed()) {
                bootWindow.destroy();
            }
        }
    });
};

// 本窗口自身的页面留在应用内，其他链接交给系统浏览器；关闭时先交给前端保存。
const installCloseBehavior = (currentWindow: BrowserWindow, kernelTarget: KernelTarget, {
    installNavigationPolicy, getWindowPathname, exitWorkspace,
}: {
    installNavigationPolicy: (window: BrowserWindow, kind: string, target: KernelTarget) => void;
    getWindowPathname: (window: BrowserWindow) => string;
    exitWorkspace: (workspace: Workspace | undefined) => void;
}): void => {
    installNavigationPolicy(currentWindow, "app", kernelTarget);
    currentWindow.on("close", (event: ElectronEvent) => {
        if (kernelTarget.mode === "remote" && (getWindowPathname(currentWindow) !== APP_PAGE ||
            !isWindowInitialized(currentWindow.webContents.id))) {
            event.preventDefault();
            exitWorkspace(runtime.state.workspaces.find((item: Workspace) =>
                item.webContentsId === currentWindow.webContents.id));
            return;
        }
        if (currentWindow && !currentWindow.isDestroyed()) {
            requestWindowClose(currentWindow, false);
        }
        event.preventDefault();
    });
};

// 返回主窗口的初始化入口；注入项只用于测试替换副作用实现。
const createMainWindow = ({
    platform: {
        process = nodeProcess,
        remote = requireElectronRemote(), fs = nodeFs,
    } = {},
    clock: {
        scheduleTimer = setTimeout,
        cancelTimer = (timer: unknown) => clearTimeout(timer as NodeJS.Timeout | undefined),
    } = {},
    kernel: {getKernelTarget = kernelEndpoint.getKernelTarget} = {},
    session: {
        getRemoteSession = connectionManager.getRemoteSession,
        createResponseHeaderFilter = sessionHeaders.createResponseHeaderFilter,
    } = {},
    ui: {
        getTitleBarOverlayOptions = windowOverlay.getTitleBarOverlayOptions,
        bindSpellcheckContextMenu = contextMenu.bindSpellcheckContextMenu,
        bindTopBarContextMenu = contextMenu.bindTopBarContextMenu,
        setStartupApplicationMenu = appMenu.setStartupApplicationMenu,
    } = {},
    navigation: {
        setProxy = windowNavigation.setProxy,
        installNavigationPolicy = windowNavigation.installNavigationPolicy,
        getWindowPathname = windowNavigation.getWindowPathname,
    } = {},
    workspace: {
        rememberWindowKernelTarget = rememberKernelTargetForWindow,
        exitWorkspace = appExit.exitWorkspace,
        getWorkspaceStartupKey = previousKernelExit.getWorkspaceStartupKey,
        // 未指定启动参数时按运行期状态判断是否隐藏启动；默认值在参数作用域求值，因此读 runtime 而不是函数内的 state。
        isOpenAsHidden = () => 1 === runtime.state.workspaces.length && runtime.state.startup.openAsHidden,
    } = {},
}: MainWindowOptions = {}) => {
    const {state, paths, writeLog} = runtime;
    const {app, BrowserWindow, screen, net} = electron;
    const initMainWindow = (kernel: string | number | KernelTarget = state.kernel.port,
        remoteAuthenticated = true): void => {
        if (!app.isReady()) {
            writeLog("initMainWindow: app not ready, skipping");
            return;
        }
        // 本机内核的启动页由本次启动记录给出，远端内核没有启动记录。
        const launch = resolveMainWindowLaunch(kernel, getKernelTarget);
        // 上次保存的位置越界或目标显示器已不存在时，落到居中显示。
        const geometry = resolveWindowState(readSavedWindowState(paths.windowStatePath, fs, writeLog),
            readDisplayMetrics(screen, writeLog), writeLog);
        // 窗口以隐藏状态创建，等前端就绪后再显示。
        const currentWindow = createMainBrowserWindow(launch.kernelTarget, geometry);
        // 远端内核直接加载；本机内核先取网络配置应用代理，代理取不到也继续加载，
        // 超时兜底由 loadMainContent 内部负责。
        loadMainContent({
            window: currentWindow,
            target: launch.kernelTarget,
            remoteAuthenticated,
            getServer: kernelEndpoint.getServer,
            fetchNetwork: (url, init) => net.fetch(url, init),
            setProxy,
            scheduleTimer,
            resolveLanguage: () => language.resolveAppLanguage(app.getPreferredSystemLanguages()),
            log: writeLog,
        });
        // 发起互联网服务请求时绕过安全策略 https://github.com/siyuan-note/siyuan/issues/5516
        currentWindow.webContents.session.webRequest.onBeforeSendHeaders(createRefererFilter());
        currentWindow.webContents.session.webRequest.onHeadersReceived(
            createResponseHeaderFilter(launch.kernelTarget));
        installCheckAuthReveal(currentWindow, launch, getWindowPathname);
        // 应用菜单由启动期菜单接管，macOS 保持系统默认菜单。
        if ("darwin" !== process.platform) {
            setStartupApplicationMenu();
        }
        installCloseBehavior(currentWindow, launch.kernelTarget, {
            installNavigationPolicy, getWindowPathname, exitWorkspace,
        });
        installWindowCloseRecovery(currentWindow, {scheduleTimer, cancelTimer});
        // 窗口进入账本后即可清除这次启动记录。
        addWorkspace({
            browserWindow: currentWindow,
            webContentsId: currentWindow.webContents.id,
            port: launch.kernelTarget.port,
            ownsKernel: launch.kernelTarget.ownsKernel,
            kernelTarget: launch.kernelTarget,
            workspaceDir: launch.pendingWorkspaceDir,
        });
        if (launch.pendingWorkspaceDir) {
            state.kernel.startups.delete(getWorkspaceStartupKey(launch.pendingWorkspaceDir));
        }
        // 前端发来就绪信号后显示主窗口并关闭启动页；本地内核首次启动时，
        // 命令行里的 siyuan:// 深链也在此时转交界面。
        attachMainWindowReady({
            scheduleTimer, cancelTimer, isOpenAsHidden, log: writeLog,
            window: currentWindow, bootWindow: launch.bootWindow, windowState: geometry.state,
            onReady: () => {
                if (launch.kernelTarget.mode === "remote") {
                    return;
                }
                const siyuanOpenURL = state.startup.initialDeepLink;
                if (siyuanOpenURL) {
                    writeLog(siyuanOpenURL);
                    currentWindow.webContents.send(Channel.SIYUAN_OPEN_URL, siyuanOpenURL);
                }
            },
        });
    };

    const createMainBrowserWindow = (kernelTarget: KernelTarget,
        {state: windowState, x, y, resetToCenter}: ResolvedWindowState): BrowserWindow => {
        const currentWindow = new BrowserWindow({
            title: "SiYuan",
            show: false,
            width: windowState.width,
            height: windowState.height,
            minWidth: MIN_WINDOW_WIDTH,
            minHeight: MIN_WINDOW_HEIGHT,
            fullscreenable: true,
            fullscreen: windowState.fullscreen,
            trafficLightPosition: {x: 8, y: 8},
            webPreferences: kernelWindowPreferences(kernelTarget, getRemoteSession),
            frame: "darwin" === process.platform,
            titleBarStyle: "hidden",
            // 首帧按默认主题的工具栏高度预留，融合页签与自定义主题由渲染进程校正。
            titleBarOverlay: getTitleBarOverlayOptions(),
            icon: appIconPath(),
        });
        remote.enable(currentWindow.webContents);
        bindSpellcheckContextMenu(currentWindow.webContents);
        bindTopBarContextMenu(currentWindow);
        rememberWindowKernelTarget(currentWindow, kernelTarget);

        if (resetToCenter) {
            currentWindow.center();
        } else {
            writeLog("window position [x=" + x + ", y=" + y + "]");
            currentWindow.setPosition(x, y);
        }
        currentWindow.webContents.userAgent = desktopUserAgent(paths.appVer, currentWindow.webContents.userAgent);
        return currentWindow;
    };

    return initMainWindow;
};

export {createMainWindow};
