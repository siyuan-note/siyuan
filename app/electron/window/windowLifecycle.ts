// 窗口创建后的生命周期接线：登记所属内核目标、按模式装设远端限制，并在页面切换、渲染进程崩溃与窗口销毁时
// 清理账本与拖拽会话。账本读写留在 windowRegistry，拖拽会话留在 blockDrag，本模块只把两者接起来。
import {shouldBlockRemoteFrameNavigation} from "../remote/remoteKernel";
import {writeLog} from "../shared/runtime";
import {
    forgetKernelTarget, forgetWindowInitialized, markExpectedRendererExitId, setWindowKernelTarget,
} from "./windowRegistry";
import {cleanupBlockDragSessions, cleanupBlockDragWindow, touchWindowFocus} from "./blockDrag";
import type {
    BrowserWindow,
    Event as ElectronEvent,
    WebContentsDidStartNavigationEventParams,
    WebContentsWillFrameNavigateEventParams,
} from "electron";
import type {KernelTarget} from "../shared/types";

/** 页面切换与窗口销毁时的拖拽清理入口；测试用它观察触发顺序。 */
type DragCleanup = {
    session: (webContentsId: number) => void;
    window: (webContentsId: number) => void;
};

const defaultDragCleanup: DragCleanup = {
    session: cleanupBlockDragSessions,
    window: cleanupBlockDragWindow,
};

/** 标记窗口退出是预期的，崩溃处理据此跳过上报。 */
const markExpectedRendererExit = (window: BrowserWindow): void => {
    if (window && !window.isDestroyed()) {
        markExpectedRendererExitId(window.webContents.id);
    }
};

// 登记窗口所属的内核目标，并按模式装设远端限制与页面切换后的清理。
const rememberWindowKernelTarget = (window: BrowserWindow, target: KernelTarget,
    dragCleanup: DragCleanup = defaultDragCleanup): void => {
    const webContentsId = window.webContents.id;
    setWindowKernelTarget(webContentsId, target);
    touchWindowFocus(webContentsId);
    window.on("focus", () => {
        touchWindowFocus(webContentsId);
    });
    if (target.mode === "remote") {
        window.webContents.on("will-frame-navigate", (event: ElectronEvent<WebContentsWillFrameNavigateEventParams>) => {
            if (shouldBlockRemoteFrameNavigation({isMainFrame: event.isMainFrame})) {
                event.preventDefault();
                writeLog("blocked subframe navigation in remote kernel mode [url=" + event.url + "]");
            }
        });
        window.webContents.on("will-attach-webview", (event: ElectronEvent) => {
            event.preventDefault();
            writeLog("blocked webview creation in remote kernel mode");
        });
    }

    window.webContents.on("did-start-navigation", (details: WebContentsDidStartNavigationEventParams) => {
        if (details.isMainFrame && !details.isSameDocument) {
            forgetWindowInitialized(webContentsId);
            dragCleanup.session(webContentsId);
        }
    });
    window.webContents.on("render-process-gone", () => {
        forgetWindowInitialized(webContentsId);
        dragCleanup.session(webContentsId);
    });
    window.webContents.once("destroyed", () => {
        forgetWindowInitialized(webContentsId);
        forgetKernelTarget(webContentsId);
        dragCleanup.window(webContentsId);
    });
};

export {markExpectedRendererExit, rememberWindowKernelTarget};
