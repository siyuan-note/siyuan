// 工作空间与应用退出编排：销毁同内核窗口、回收托盘、保存窗口状态，并按关机、更新与切换连接的状态退出。
import {app, BrowserWindow, globalShortcut} from "electron";
import * as fs from "node:fs";
import {errorMessage} from "../shared/errors";
import {paths, state, writeLog} from "../shared/runtime";
import {hasTray} from "../shared/traySupport";
import {markExpectedRendererExit} from "./windowLifecycle";
import {removeWorkspace} from "./windowRegistry";
import type {Workspace} from "../shared/types";

// 切换到另一内核后需要重启才能生效，重启参数由连接管理器登记。
const relaunchConnection = (): void => {
    if (state.exit.pendingConnectionArgs) {
        app.relaunch({args: state.exit.pendingConnectionArgs});
        state.exit.pendingConnectionArgs = undefined;
    }
};

// 退出一个工作空间：销毁同内核的其余窗口 - 移出账本 - 回收托盘 - 最后一个工作空间时保存状态并退出。
const exitWorkspace = (workspace: Workspace | undefined, errorWindowId?: number): void => {
    if (!workspace) {
        return;
    }
    const workspaces = state.workspaces;
    const workspaceIndex = workspaces.indexOf(workspace);
    const mainWindow = workspace.browserWindow;
    const tray = workspace.tray;

    destroyKernelWindows(mainWindow, workspace.kernelTarget?.origin);
    if (workspaceIndex > -1) {
        // 还有别的工作空间时直接销毁本窗口，最后留下的那个走完整退出流程。
        if (workspaces.length > 1 && mainWindow && !mainWindow.isDestroyed()) {
            markExpectedRendererExit(mainWindow);
            mainWindow.destroy();
        }
        removeWorkspace(workspace);
    }

    if (tray && hasTray(process.platform)) {
        tray.destroy();
    }

    if (workspaces.length === 0 && mainWindow) {
        saveWindowState(mainWindow);
        finishLastWorkspace(mainWindow, errorWindowId);
    }
};

// 关闭连接同一内核的所有非主窗口；启动页等 file: 地址无法解析为 URL，跳过该窗口。
const destroyKernelWindows = (mainWindow: BrowserWindow, kernelOrigin: string | undefined): void => {
    BrowserWindow.getAllWindows().forEach((item: BrowserWindow) => {
        try {
            const currentURL = new URL(item.webContents.getURL());
            if (kernelOrigin && kernelOrigin === currentURL.origin) {
                if (!mainWindow || mainWindow.id !== item.id) {
                    item.destroy();
                }
            }
        } catch (e) {
            // 无法解析的地址不属于任何内核页面。
        }
    });
};

// 保存窗口状态供下次启动恢复。isMaximized 记录关闭时是否最大化；x/y/width/height 须用 getNormalBounds，
// 其在任意窗口状态下均返回向下还原时的矩形。而 getBounds 在最大化时返回全屏尺寸，会导致还原时贴边。
// https://github.com/siyuan-note/siyuan/issues/18154
// https://www.electronjs.org/docs/latest/api/browser-window#wingetnormalbounds
const saveWindowState = (mainWindow: BrowserWindow): void => {
    try {
        if (state.exit.resetWindowStateOnRestart) {
            fs.writeFileSync(paths.windowStatePath, "{}");
            return;
        }
        const bounds = mainWindow.getNormalBounds();
        fs.writeFileSync(paths.windowStatePath, JSON.stringify({
            isMaximized: mainWindow.isMaximized(),
            fullscreen: mainWindow.isFullScreen(),
            isDevToolsOpened: mainWindow.webContents.isDevToolsOpened(),
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        }));
    } catch (e) {
        writeLog(errorMessage(e));
    }
};

// 错误窗口占位时保留它并关闭其余窗口；否则按关机、更新安装与切换连接的状态决定如何退出。
const finishLastWorkspace = (mainWindow: BrowserWindow, errorWindowId?: number): void => {
    markExpectedRendererExit(mainWindow);
    if (errorWindowId) {
        BrowserWindow.getAllWindows().forEach((item: BrowserWindow) => {
            if (errorWindowId !== item.id) {
                item.destroy();
            }
        });
    } else if (state.exit.keepOpenForShutdown || state.exit.keepOpenForUpdate) {
        mainWindow.destroy();
    } else {
        relaunchConnection();
        app.exit();
    }
    globalShortcut.unregisterAll();
    writeLog("exited ui");
};

const exitApp = (port: string | number | undefined | null, errorWindowId?: number): void => {
    if (port === undefined || port === null) {
        return;
    }
    const workspace = state.workspaces.find((item: Workspace) => item.ownsKernel && port.toString() === item.port.toString());
    exitWorkspace(workspace, errorWindowId);
};

export {relaunchConnection, exitWorkspace, exitApp};
