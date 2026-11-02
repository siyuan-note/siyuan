// 独立窗口：校验渲染进程请求的地址、外观与几何，创建窗口并在首帧或短延迟后显示。
// 请求字段全部来自渲染进程，一律按不可信输入处理，非法值退回默认外观而不是报错。
import * as electron from "electron";
import * as runtime from "../shared/runtime";
import {WINDOW_PAGE} from "../shared/pagePaths";
import {appIconPath, desktopUserAgent, MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH} from "../shared/desktopDefaults";
import {kernelWindowPreferences} from "./windowPreferences";
import {getWindowKernelTarget, isWindowInitialized} from "./windowRegistry";
import {getWindowPathname, installNavigationPolicy} from "./windowNavigation";
import {getRemoteSession} from "../remote/connectionManager";
import {windowWorkspaces} from "./windowWorkspaces";
import {showWindow} from "./windowVisibility";
import {markExpectedRendererExit, rememberWindowKernelTarget} from "./windowLifecycle";
import {bindSpellcheckContextMenu} from "./contextMenu";
import {getCaptionHeight, getTitleBarOverlayOptions} from "./windowControlsOverlay";
import {normalizeWindowGeometry} from "./windowGeometry";
import {requireElectronRemote} from "../shared/electronRemote";
import type {LogFunction} from "../shared/types";
import {Channel} from "../shared/channels";

// 独立窗口只接受本机内核的 window.html，其余地址一律忽略。
const WINDOW_PATHNAME = WINDOW_PAGE;
const WORKSPACE_ID_PATTERN = /^\d{14}-[a-z0-9]{7}$/;
const COLOR_PATTERN = /^#[\da-f]{6}$/i;
// ready-to-show 在本应用里可能晚到 1 秒以上，定时器保证窗口及时出现。
const REVEAL_DELAY_MS = 150;
const FORCE_REVEAL_MS = 60000;

// 协作者签名从真实模块派生，上游改动后不会留下过期的手写副本。
type OpenWindowOptions = {
    process?: {platform: NodeJS.Platform};
    appVer?: string;
    writeLog?: LogFunction;
    setTimeout?: (callback: () => void, ms: number) => unknown;
    clearTimeout?: (timer: unknown) => void;
    isWindowInitialized?: typeof isWindowInitialized;
    getWindowKernelTarget?: typeof getWindowKernelTarget;
    getWindowPathname?: typeof getWindowPathname;
    getRemoteSession?: typeof getRemoteSession;
    windowWorkspaces?: typeof windowWorkspaces;
    showWindow?: typeof showWindow;
    installNavigationPolicy?: typeof installNavigationPolicy;
    markExpectedRendererExit?: typeof markExpectedRendererExit;
    rememberWindowKernelTarget?: typeof rememberWindowKernelTarget;
    bindSpellcheckContextMenu?: typeof bindSpellcheckContextMenu;
    getCaptionHeight?: typeof getCaptionHeight;
    getTitleBarOverlayOptions?: typeof getTitleBarOverlayOptions;
    normalizeWindowGeometry?: typeof normalizeWindowGeometry;
};

const createOpenWindowHandler = ({
    process = globalThis.process, appVer = runtime.paths.appVer,
    writeLog = runtime.writeLog, setTimeout = globalThis.setTimeout,
    clearTimeout = (timer: unknown) => globalThis.clearTimeout(timer as NodeJS.Timeout | undefined),
    isWindowInitialized: isInitialized = isWindowInitialized,
    getWindowKernelTarget: getKernelTarget = getWindowKernelTarget,
    getWindowPathname: getPathname = getWindowPathname,
    getRemoteSession: getSession = getRemoteSession,
    windowWorkspaces: workspaces = windowWorkspaces,
    showWindow: show = showWindow,
    installNavigationPolicy: applyNavigationPolicy = installNavigationPolicy,
    markExpectedRendererExit: markExpectedExit = markExpectedRendererExit,
    rememberWindowKernelTarget: rememberTarget = rememberWindowKernelTarget,
    bindSpellcheckContextMenu: bindSpellcheck = bindSpellcheckContextMenu,
    getCaptionHeight: captionHeight = getCaptionHeight,
    getTitleBarOverlayOptions: titleBarOverlay = getTitleBarOverlayOptions,
    normalizeWindowGeometry: normalizeGeometry = normalizeWindowGeometry,
}: OpenWindowOptions = {}) => (event: {sender: {id: number}}, data: {
    url: string;
    themeMode?: unknown;
    backgroundColor?: unknown;
    foregroundColor?: unknown;
    compactMode?: unknown;
    alwaysOnTop?: boolean;
    position?: {x: number; y: number};
    width?: number;
    height?: number;
    // 只有通过校验的几何数据才会用于定位，这里保持宽松类型以免在调用前断言。
    windowGeometry?: {maximized?: unknown; fullscreen?: unknown};
}): void => {
    const {BrowserWindow, screen} = electron;
    const kernelTarget = getKernelTarget(event.sender.id);
    if (!kernelTarget) {
        writeLog("ignored opening a window without a kernel target");
        return;
    }
    let windowURL: URL;
    try {
        windowURL = new URL(data.url);
    } catch (error) {
        writeLog("ignored opening a window with an invalid URL");
        return;
    }
    if (windowURL.origin !== kernelTarget.origin || windowURL.pathname !== WINDOW_PATHNAME) {
        writeLog("ignored opening a window outside the kernel origin");
        return;
    }
    if (kernelTarget.mode === "remote") {
        windowURL.searchParams.set("remote", "1");
    }
    const workspaceID = windowURL.searchParams.get("windowWorkspace");
    if (workspaceID) {
        if (!WORKSPACE_ID_PATTERN.test(workspaceID)) {
            return;
        }
        const existingWindow = workspaces.get(kernelTarget.origin, workspaceID);
        if (existingWindow) {
            show(existingWindow);
            return;
        }
    }
    const themeMode = data.themeMode === "dark" ? "dark" : "light";
    const backgroundColor = typeof data.backgroundColor === "string" && COLOR_PATTERN.test(data.backgroundColor) ?
        data.backgroundColor : (themeMode === "dark" ? "#1e1e1e" : "#ffffff");
    const foregroundColor = typeof data.foregroundColor === "string" && COLOR_PATTERN.test(data.foregroundColor) ?
        data.foregroundColor : (themeMode === "dark" ? "#d4d4d4" : "#222222");
    windowURL.searchParams.set("windowThemeMode", themeMode);
    windowURL.searchParams.set("windowBackground", backgroundColor);
    windowURL.searchParams.set("windowForeground", foregroundColor);
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const mainBounds = mainWindow.getBounds();
    const mainScreen = screen.getDisplayNearestPoint({x: mainBounds.x, y: mainBounds.y});
    const geometry = workspaceID ? normalizeGeometry(data.windowGeometry, screen) : undefined;
    const win = new BrowserWindow({
        title: "SiYuan",
        // 先在隐藏状态完成定位和加载，等画面就绪或短暂延迟后再显示，
        // 避免窗口映射早于首帧提交时出现系统填充的近白色占位帧。
        show: false,
        backgroundColor,
        trafficLightPosition: {x: 8, y: 13},
        width: Math.floor(data.width || mainScreen.size.width * 0.7),
        height: Math.floor(data.height || mainScreen.size.height * 0.9),
        ...geometry,
        minWidth: MIN_WINDOW_WIDTH,
        minHeight: MIN_WINDOW_HEIGHT,
        fullscreenable: true,
        frame: "darwin" === process.platform,
        icon: appIconPath(),
        titleBarStyle: "hidden",
        // 独立文档窗口的顶栏使用面板高度，并跟随当前界面密度预留。
        titleBarOverlay: titleBarOverlay(process.platform, captionHeight(data.compactMode === true, true)),
        webPreferences: kernelWindowPreferences(kernelTarget, getSession),
    });
    requireElectronRemote().enable(win.webContents);
    bindSpellcheck(win.webContents);
    rememberTarget(win, kernelTarget);

    if (workspaceID) {
        workspaces.associate(win, kernelTarget.origin, workspaceID);
    }

    if (!geometry && data.position) {
        win.setPosition(data.position.x, data.position.y);
    } else if (!geometry) {
        win.center();
    }
    win.setAlwaysOnTop(!!data.alwaysOnTop, "win32" === process.platform ? "pop-up-menu" : "floating");
    win.webContents.userAgent = desktopUserAgent(appVer, win.webContents.userAgent);
    win.webContents.session.setSpellCheckerLanguages(["en-US"]);
    // 显示时机：首帧（ready-to-show）或短延迟，谁先到用谁；两者都晚于创建，
    // 因此首帧直接是主题背景，不会闪白。
    let revealed = false;
    const revealWindow = (): void => {
        if (revealed || win.isDestroyed()) {
            return;
        }
        revealed = true;
        clearTimeout(revealTimer);
        // 隐藏窗口上最大化或进入全屏会直接映射窗口，因此和显示一起执行。
        if (geometry && data.windowGeometry?.maximized) {
            win.maximize();
        }
        if (geometry && data.windowGeometry?.fullscreen) {
            win.setFullScreen(true);
        }
        show(win);
    };
    win.once("ready-to-show", revealWindow);
    const revealTimer = setTimeout(revealWindow, REVEAL_DELAY_MS);
    // 渲染异常时仍显示窗口，避免留下无法访问的隐藏窗口。
    const forceRevealTimer = setTimeout(() => {
        if (!revealed) {
            writeLog("detached window ready-to-show timeout, show it anyway");
            revealWindow();
        }
    }, FORCE_REVEAL_MS);
    win.once("closed", () => {
        clearTimeout(revealTimer);
        clearTimeout(forceRevealTimer);
    });
    win.loadURL(windowURL.href);
    applyNavigationPolicy(win, "window", kernelTarget);
    win.on("close", (closeEvent: {preventDefault: () => void}) => {
        // 关闭前未初始化的窗口与远端内核下的非 window 页面直接销毁，避免留下无法访问的窗口。
        if (!isInitialized(win.webContents.id) ||
            (kernelTarget.mode === "remote" && getPathname(win) !== WINDOW_PATHNAME)) {
            closeEvent.preventDefault();
            markExpectedExit(win);
            win.destroy();
            return;
        }
        if (!win.isDestroyed()) {
            win.webContents.send(Channel.SIYUAN_SAVE_CLOSE);
        }
        closeEvent.preventDefault();
    });
    const targetScreen = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    if (!geometry && mainScreen.id !== targetScreen.id) {
        win.setBounds(targetScreen.workArea);
    }
};

export {createOpenWindowHandler};
