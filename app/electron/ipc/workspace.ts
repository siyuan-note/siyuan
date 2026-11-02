// 工作空间通道：首次初始化、打开另一工作空间、退出、窗口显示与独立窗口创建。
import * as path from "node:path";
import * as electron from "electron";
import {paths, state, writeLog} from "../shared/runtime";
import {hasTray} from "../shared/traySupport";
import {getWindowByContentId} from "../window/windowLookup";
import {showWindow} from "../window/windowVisibility";
import {exitWorkspace as exitWorkspaceWindow, exitApp as exitAppWindow} from "../window/appExit";
import {
    findWorkspaceByWebContents, getWindowKernelTarget, markWindowInitialized,
} from "../window/windowRegistry";
import {markExpectedRendererExit} from "../window/windowLifecycle";
import {getKernelConnection} from "../remote/remoteKernel";
import {createOpenWindowHandler} from "../window/openWindow";
import {createWorkspaceTray, resetTrayMenu, showHideWindow} from "../window/trayMenu";
import {appIconPath} from "../shared/desktopDefaults";
import {createLocalWorkspaceDirQuery} from "../kernel/workspaceInfo";
import type {Tray} from "electron";
import type {InitKernel, InitMainWindow, Workspace} from "../shared/types";
import {Channel} from "../shared/channels";

// 远程内核窗口把用户切到远程前端，期间累积的 URL 需要在这个窗口就绪后再投递。
const scheduleRemoteOpenURLFlush = (window: electron.BrowserWindow | undefined): void => {
    setTimeout(() => {
        if (!window || window.isDestroyed()) {
            return;
        }
        state.pendingRemoteOpenURLs.splice(0).forEach(url => window.webContents.send(Channel.SIYUAN_OPEN_URL, url));
    }, 100);
};

const getLocalKernelWorkspaceDir = createLocalWorkspaceDirQuery({
    fetch: (url, init) => electron.net.fetch(url, init),
    writeLog,
});

const registerWorkspaceIpc = ({
    initKernel, initMainWindow, exitWorkspace = exitWorkspaceWindow, exitApp = exitAppWindow,
}: {
    initKernel: InitKernel;
    initMainWindow: InitMainWindow;
    exitWorkspace?: (workspace: Workspace | undefined) => void;
    exitApp?: (port: string | number) => void;
}): void => {
    electron.ipcMain.on(Channel.SIYUAN_QUIT, (event, port) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const workspaceItem = findWorkspaceByWebContents(event.sender.id);
        if (kernelTarget?.mode === "remote") {
            if (workspaceItem) {
                exitWorkspace(workspaceItem);
            } else {
                const senderWindow = electron.BrowserWindow.fromWebContents(event.sender);
                if (senderWindow) {
                    markExpectedRendererExit(senderWindow);
                    senderWindow.destroy();
                }
            }
            return;
        }
        exitApp(port);
    });

    electron.ipcMain.on(Channel.SIYUAN_SHOW_WINDOW, (event) => {
        const mainWindow = getWindowByContentId(event.sender.id);
        if (!mainWindow) {
            return;
        }
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
    });

    electron.ipcMain.on(Channel.SIYUAN_OPEN_WINDOW, createOpenWindowHandler());

    electron.ipcMain.on(Channel.SIYUAN_OPEN_WORKSPACE, (event, data) => {
        if (getWindowKernelTarget(event.sender.id)?.mode === "remote") {
            writeLog("ignored opening a local workspace in remote kernel mode");
            return;
        }
        if (state.exit.updateInstall) {
            writeLog("ignored opening workspace while installing update");
            return;
        }
        const foundWorkspace = state.workspaces.find((item) => {
            if (item.workspaceDir === data.workspace) {
                showWindow(item.browserWindow);
                return true;
            }
        });
        if (!foundWorkspace) {
            initKernel({workspace: data.workspace}).then((startedKernelPort) => {
                if (startedKernelPort) {
                    initMainWindow(startedKernelPort);
                }
            });
        }
    });

    // 首次初始化：登记窗口、按平台创建托盘、回传内核能力，重复初始化时只刷新托盘文案。
    electron.ipcMain.handle(Channel.SIYUAN_INIT, async (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        if (kernelTarget) {
            markWindowInitialized(event.sender.id);
        }
        const capabilities = getKernelConnection(kernelTarget);
        const exitWS = state.workspaces.find(item => {
            if (event.sender.id === item.webContentsId && item.initialized) {
                if (item.tray && hasTray(process.platform)) {
                    // 语言变化后前端会重新初始化，这里按新文案重建托盘菜单。
                    resetTrayMenu(item.tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
        if (exitWS) {
            if (!exitWS.ownsKernel) {
                scheduleRemoteOpenURLFlush(exitWS.browserWindow);
            }
            return capabilities;
        }

        const workspaceItem = state.workspaces.find((item) => event.sender.id === item.webContentsId);
        if (workspaceItem) {
            workspaceItem.initialized = true;
            // 授权页在登录前加载，内核不向其下发工作空间路径，改由主进程向本机内核查询。
            const workspaceDir: string = workspaceItem.ownsKernel ?
                data.workspaceDir || await getLocalKernelWorkspaceDir(workspaceItem) : "";
            workspaceItem.workspaceDir = workspaceDir;
            let tray: Tray | undefined;
            if (hasTray(process.platform)) {
                tray = createWorkspaceTray(appIconPath());
                if (tray) {
                    const trayName = workspaceItem.ownsKernel ? path.basename(workspaceDir) :
                        new URL(workspaceItem.kernelTarget.origin).host;
                    tray.setToolTip(`${trayName} - SiYuan v${paths.appVer}`);
                    const mainWindow = getWindowByContentId(event.sender.id);
                    if (!mainWindow || mainWindow.isDestroyed()) {
                        tray.destroy();
                        tray = undefined;
                    } else {
                        const createdTray = tray;
                        resetTrayMenu(createdTray, data.languages, mainWindow);
                        createdTray.on("click", () => {
                            showHideWindow(createdTray, data.languages, mainWindow);
                        });
                    }
                }
            }
            workspaceItem.tray = tray;
        }
        if (workspaceItem?.ownsKernel) {
            await electron.net.fetch(workspaceItem.kernelTarget.origin + "/api/system/uiproc?pid=" +
                process.pid, {method: "POST"});
        } else if (workspaceItem) {
            scheduleRemoteOpenURLFlush(workspaceItem.browserWindow);
        }
        return capabilities;
    });
};

export {registerWorkspaceIpc};
