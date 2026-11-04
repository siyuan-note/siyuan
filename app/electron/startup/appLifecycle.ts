import * as electron from "electron";
import {isSystemShuttingDown, state, writeLog} from "../shared/runtime";
import * as timing from "../shared/timing";
import {APP_PAGE} from "../shared/pagePaths";
import {isDeepLink} from "../shared/builtinArgs";
import {relaunchConnection} from "../window/appExit";
import {showWindow} from "../window/windowVisibility";
import {getWindowPathname} from "../window/windowNavigation";
import {getActiveWindow, isWindowInitialized, removeWorkspace} from "../window/windowRegistry";
import {markExpectedRendererExit} from "../window/windowLifecycle";
import {handleWebContentsCreated} from "../window/webviewDevTools";
import {createRenderProcessGoneHandler} from "../window/rendererCrash";
import {beginForcedSystemShutdown, beginGracefulSystemShutdown} from "./systemShutdown";
import {queueSecondInstance} from "./secondInstance";
import type {NotebookSystemLock} from "../kernel/notebookSystemLock";
import {syncAfterResume} from "../window/syncAfterResume";
import {getRemoteSession} from "../remote/connectionManager";
import * as bootWindows from "../window/bootWindows";
import {initRemoteKernel} from "../remote/remoteBoot";
import {isMarkdownPath} from "../markdown/launch";
import {
    acceptMarkdownFileOpen, isMarkdownStartup, routeMarkdownLaunch,
} from "./markdownEditors";
import type {
    BrowserWindow, Event as ElectronEvent, HandlerDetails, WebContents, WindowOpenHandlerResponse,
} from "electron";
import type {InitMainWindow} from "../shared/types";
import {Channel} from "../shared/channels";

type AppLifecycleOptions = {
    initMainWindow: InitMainWindow;
    settingsWindowPolicy: (contents: WebContents, details: HandlerDetails) => WindowOpenHandlerResponse | undefined;
};

// 深链在本地内核尚未就绪时到达：先按此节奏轮询工作空间，再留出界面初始化时间。
const DEEP_LINK_WAIT_ATTEMPTS = 10;
const DEEP_LINK_WAIT_INTERVAL_MS = 500;
const DEEP_LINK_INIT_GRACE_MS = 1500;

// 进程级窗口与深链事件在这里只做登记，处理逻辑各自具名，顺序即注册顺序。
const registerAppLifecycle = ({
    initMainWindow, settingsWindowPolicy,
}: AppLifecycleOptions): void => {
    if ("win32" === process.platform) {
        electron.app.on("browser-window-created", watchWindowSessionEnd);
    }
    electron.app.on("open-url", (_event, url) => void handleOpenURL(url)); // macOS 深链
    electron.app.on("open-file", handleOpenFile); // macOS 文件打开，可能早于 ready
    electron.app.on("activate", (event) => handleActivate(initMainWindow, event));
    electron.app.on("web-contents-created", (event, contents) =>
        handleWebContentsCreated(event, contents, {settingsWindowPolicy}));
    electron.app.on("before-quit", handleBeforeQuit);
    electron.app.on("will-quit", relaunchConnection);
};

// Windows 关机、重启或注销时取消本次会话结束，等待内核安全退出后再关闭思源。
const watchWindowSessionEnd = (_event: ElectronEvent, window: BrowserWindow): void => {
    window.on("query-session-end", (sessionEvent: ElectronEvent) => {
        writeLog("query-session-end");
        sessionEvent.preventDefault();
        beginGracefulSystemShutdown();
    });
    window.on("session-end", () => {
        writeLog("session-end");
        beginForcedSystemShutdown();
    });
};

// macOS 把文件拖到应用图标或从 Finder 打开时触发：早于 ready 也要排队，不能触发工作空间初始化。
const handleOpenFile = (event: ElectronEvent, filePath: string): void => {
    if (!isMarkdownPath(filePath)) {
        return;
    }
    event.preventDefault();
    if (state.exit.updateInstall || isSystemShuttingDown()) {
        return;
    }
    if (!electron.app.isReady()) {
        acceptMarkdownFileOpen();
    }
    routeMarkdownLaunch(["--markdown=" + filePath]);
};

// 系统深链：远端模式只转给主窗口，主窗口未就绪时暂存；本地模式等第一个工作空间打开后广播。
const handleOpenURL = async (url: string): Promise<void> => {
    if (state.exit.updateInstall) {
        writeLog("ignored URL while installing update");
        return;
    }
    if (!isDeepLink(url)) {
        return;
    }
    if (state.startup.remoteKernelTarget) {
        const mainWorkspace = state.workspaces[0];
        if (mainWorkspace?.browserWindow && !mainWorkspace.browserWindow.isDestroyed() &&
            isWindowInitialized(mainWorkspace.webContentsId)) {
            showWindow(mainWorkspace.browserWindow);
            mainWorkspace.browserWindow.webContents.send(Channel.SIYUAN_OPEN_URL, url);
        } else {
            state.pendingRemoteOpenURLs.push(url);
        }
        return;
    }
    // 本地内核可能还在启动：工作空间为空时先轮询等待它打开。
    let isBackground = true;
    if (state.workspaces.length === 0) {
        isBackground = false;
        for (let index = 0; index < DEEP_LINK_WAIT_ATTEMPTS; index++) {
            await timing.sleep(DEEP_LINK_WAIT_INTERVAL_MS);
            if (state.workspaces.length > 0) {
                break;
            }
        }
    }
    if (!isBackground) {
        await timing.sleep(DEEP_LINK_INIT_GRACE_MS);
    }
    state.workspaces.forEach(item => {
        if (item.browserWindow && !item.browserWindow.isDestroyed()) {
            item.browserWindow.webContents.send(Channel.SIYUAN_OPEN_URL, url);
        }
    });
};

// Dock 激活：有工作空间就前置窗口，全部窗口都关闭时重新拉起内核与主窗口。
const handleActivate = (initMainWindow: InitMainWindow, event: ElectronEvent): void => {
    if (state.exit.updateInstall || isSystemShuttingDown()) {
        return;
    }
    if (isMarkdownStartup() && state.workspaces.length === 0) {
        // macOS 重新打开应用不会创建第二个进程，复用普通启动入口执行工作空间检查。
        if (electron.app.isReady()) {
            queueSecondInstance(event, [process.execPath]);
        }
        return;
    }
    // Markdown 窗口独立于工作空间：只有它们时直接前置，不拉起内核。
    if (state.markdown.windows?.hasWindows() && state.workspaces.length === 0) {
        state.markdown.windows.focus();
        return;
    }
    if (state.exit.updateInstall || state.startup.remoteKernelArgError) {
        return;
    }

    if (state.workspaces.length > 0) {
        const activeWindow = getActiveWindow();
        const mainWindow = (activeWindow && !activeWindow.isDestroyed()) ?
            activeWindow : state.workspaces[0].browserWindow;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
        }
    }
    if (electron.BrowserWindow.getAllWindows().length > 0) {
        return;
    }
    if (state.startup.remoteKernelTarget) {
        initRemoteKernel(state.startup.remoteKernelTarget, bootWindows).then((result) => {
            if (result) {
                initMainWindow(result.target, result.authenticated);
            }
        }).catch((error) => writeLog("reactivate remote kernel failed: " + error));
    } else {
        initMainWindow();
    }
};

// 退出前把保存请求交给前端：无内核的临时窗口直接关闭，其余窗口等前端回存后退出。
const handleBeforeQuit = (event: ElectronEvent): void => {
    if (state.exit.keepOpenForUpdate) {
        event.preventDefault();
        return;
    }
    // 先完成独立 Markdown 窗口的退出保护，再走工作空间退出流程。
    if (state.markdown.lifecycle?.beforeQuit(event)) {
        return;
    }
    state.workspaces.slice().forEach(item => {
        const pathname = getWindowPathname(item.browserWindow);
        if (!item.ownsKernel && (pathname !== APP_PAGE ||
            !isWindowInitialized(item.webContentsId))) {
            removeWorkspace(item);
            markExpectedRendererExit(item.browserWindow);
            item.browserWindow.destroy();
            return;
        }
        if (item.browserWindow && !item.browserWindow.isDestroyed()) {
            event.preventDefault();
            item.browserWindow.webContents.send(Channel.SIYUAN_SAVE_CLOSE, true);
        }
    });
};

const registerRuntimeHandlers = (notebookSystemLock: NotebookSystemLock): void => {
    electron.app.on("render-process-gone", createRenderProcessGoneHandler());

    // 电源相关事件必须放在 whenReady 里面，否则会导致 Linux 端无法正常启动。
    // Trace/breakpoint trap (core dumped) https://github.com/siyuan-note/siyuan/issues/9347
    electron.powerMonitor.on("suspend", () => {
        writeLog("system suspend");
    });
    electron.powerMonitor.on("resume", async () => {
        writeLog("system resume");
        void notebookSystemLock.retry();
        await syncAfterResume({
            writeLog, isOnline: (): boolean => electron.net.isOnline(), workspaces: state.workspaces,
            session: {defaultSession: electron.session.defaultSession},
            getRemoteSession,
        });
    });
    electron.powerMonitor.on("shutdown", () => {
        writeLog("system shutdown");
        beginForcedSystemShutdown();
    });
    electron.powerMonitor.on("lock-screen", () => {
        writeLog("system lock-screen");
        let applicationLocked = false;
        const lockApplication = () => {
            if (applicationLocked) {
                return;
            }
            applicationLocked = true;
            electron.BrowserWindow.getAllWindows().forEach(item => {
                item.webContents.send(Channel.SIYUAN_SEND_WINDOWS, {cmd: "lockscreenByMode"});
            });
        };
        // 编辑器提交完成前保留访问会话，但内核请求失败不能延迟应用锁屏。
        const timeout = setTimeout(lockApplication, 1000);
        void notebookSystemLock.lock().finally(() => {
            clearTimeout(timeout);
            lockApplication();
        });
    });
    electron.powerMonitor.on("unlock-screen", () => {
        void notebookSystemLock.retry();
    });
};

export {registerAppLifecycle, registerRuntimeHandlers};
