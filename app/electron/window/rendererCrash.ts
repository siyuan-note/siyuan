import * as runtime from "../shared/runtime";
import * as appExit from "./appExit";
import * as kernelEndpoint from "../kernel/kernelEndpoint";
import * as bootWindows from "./bootWindows";
import {cleanupBlockDragSessions} from "./blockDrag";
import {getBootWindows, takeExpectedRendererExit} from "./windowRegistry";
import {writeAppCrashMarker} from "../shared/crashHistory";
import type {
    Event as ElectronEvent,
    RenderProcessGoneDetails,
    WebContents,
} from "electron";
import type {LoadBootWindow, Workspace} from "../shared/types";

// 内核以这些原因退出视为异常，重启后进入安全模式。
const SAFE_MODE_EXIT_REASONS = new Set(["abnormal-exit", "killed", "crashed", "oom", "memory-eviction"]);

/** 崩溃处理各步的替换点；不传时取真实实现。 */
type RenderProcessGoneOverrides = {
    loadBootWindow?: LoadBootWindow;
    takeExpectedRendererExit?: (webContentsId: number) => boolean;
    requestKernelExit?: typeof kernelEndpoint.requestKernelExit;
    exitWorkspace?: typeof appExit.exitWorkspace;
    exitApp?: typeof appExit.exitApp;
    writeAppCrashMarker?: typeof writeAppCrashMarker;
    safeModeReasons?: Set<string>;
};

// 渲染进程崩溃监听，只有工作空间主窗口的非预期崩溃才会触发安全模式。
const createRenderProcessGoneHandler = ({
    loadBootWindow = bootWindows.loadBootWindow,
    takeExpectedRendererExit: consumeExpectedExit = takeExpectedRendererExit,
    requestKernelExit = kernelEndpoint.requestKernelExit,
    exitWorkspace = appExit.exitWorkspace,
    exitApp = appExit.exitApp,
    writeAppCrashMarker: writeMarker = writeAppCrashMarker,
    safeModeReasons = SAFE_MODE_EXIT_REASONS,
}: RenderProcessGoneOverrides = {}) => {
    // 崩溃处理可能重复投递，这里按处理器实例去重。
    const handledCrashWebContents = new Set<number>();
    return (event: ElectronEvent, webContents: WebContents, details: RenderProcessGoneDetails): void => {
        const {state, writeLog, isSystemShuttingDown} = runtime;
        const workspaces = state.workspaces;
        writeLog("Render process gone [reason=" + details.reason + ", exitCode=" + details.exitCode + "]");
        cleanupBlockDragSessions(webContents.id);
        if (state.exit.updateInstall) {
            writeLog("ignore renderer exit during update [webContentsId=" + webContents.id + "]");
            return;
        }
        if (isSystemShuttingDown()) {
            writeLog("ignore renderer exit during system shutdown [webContentsId=" + webContents.id + "]");
            return;
        }
        if (consumeExpectedExit(webContents.id)) {
            writeLog("ignore expected renderer exit [webContentsId=" + webContents.id + "]");
            return;
        }

        const crashedBootWindow = Array.from(getBootWindows())
            .find(window => window && !window.isDestroyed() && window.webContents.id === webContents.id);
        if (crashedBootWindow) {
            if (!crashedBootWindow.appearanceFallback) {
                writeLog("boot renderer exited, reload without custom appearance");
                loadBootWindow({disableAppearance: true, window: crashedBootWindow,
                    port: crashedBootWindow.kernelPort, lang: crashedBootWindow.lang});
            }
            return;
        }

        const workspace = workspaces.find((item: Workspace) => item.webContentsId === webContents.id);
        if (!workspace) {
            writeLog("ignore non-workspace renderer exit [webContentsId=" + webContents.id + "]");
            return;
        }
        if (!safeModeReasons.has(details.reason)) {
            writeLog("ignore renderer exit reason [reason=" + details.reason + "]");
            return;
        }
        if (handledCrashWebContents.has(webContents.id)) {
            return;
        }

        handledCrashWebContents.add(webContents.id);
        if (!workspace.ownsKernel) {
            writeLog("remote renderer exited without stopping the remote kernel [origin=" +
                workspace.kernelTarget.origin + "]");
            exitWorkspace(workspace);
            return;
        }
        writeMarker(workspace, details);
        requestKernelExit(workspace.port, {
            force: true,
            setCurrentWorkspace: false,
        });
        exitApp(workspace.port); // 退出崩溃的工作空间，下次启动时由用户选择启动方式。
    };
};

export {createRenderProcessGoneHandler};
