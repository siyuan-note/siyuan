// 应用级通道：窗口生命周期事件登记、连接管理窗口、macOS 应用菜单同步与立即退出。
import * as path from "node:path";
import {pathToFileURL} from "node:url";
import * as electron from "electron";
import {paths, state} from "../shared/runtime";
import {APP_PAGE, CHECK_AUTH_PAGE} from "../shared/pagePaths";
import {getWindowByContentId} from "../window/windowLookup";
import {getWindowPathname} from "../window/windowNavigation";
import {
    getCurrentBootWindow, getWindowKernelTarget, isHandshaken, markActiveWindow, markHandshaken,
} from "../window/windowRegistry";
import {applyMacAppMenuForWindow, forgetAppMenuWebContents, rememberAppMenu} from "../window/appMenuSession";
import {cancelRemoteBoot} from "../remote/remoteBoot";
import {getConnectionManager} from "../remote/connectionRuntime";
import {Channel} from "../shared/channels";

const registerAppEventIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_MANAGE_CONNECTIONS, (event, options) => {
        const target = getWindowKernelTarget(event.sender.id);
        const localPages = ["init.html", "workspace.html", ...(state.startup.remoteKernelTarget ? ["boot.html"] : [])]
            .map(name => pathToFileURL(path.join(paths.assetsDir, name)).href);
        const localPage = localPages.includes(event.senderFrame?.url.split("?")[0] as string);
        const connectionManager = getConnectionManager();
        if (connectionManager && event.senderFrame === event.sender.mainFrame && (localPage || (target &&
            [APP_PAGE, CHECK_AUTH_PAGE].includes(getWindowPathname(electron.BrowserWindow.fromWebContents(event.sender)))))) {
            connectionManager.show({lang: options?.lang, origin: options?.origin});
            const currentBoot = getCurrentBootWindow();
            if (state.startup.remoteKernelTarget && currentBoot && !currentBoot.isDestroyed()) {
                cancelRemoteBoot();
                currentBoot.destroy();
            }
        }
    });

    // 渲染进程只同步语言标识和菜单配置，文案由主进程读取。
    electron.ipcMain.on(Channel.SIYUAN_SYNC_APP_MENU, (event, sync) => {
        if ("darwin" !== process.platform) {
            return;
        }
        if (!sync || typeof sync.lang !== "string" || !sync.hotkey || typeof sync.hotkey !== "object") {
            return;
        }
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const workspaceDir = kernelTarget?.mode === "remote"
            ? "remote:" + kernelTarget.origin
            : (typeof sync.workspaceDir === "string" && sync.workspaceDir)
                ? sync.workspaceDir
                : ("webContents:" + event.sender.id);
        rememberAppMenu(event.sender.id, workspaceDir, sync);
    });

    // 前端在首次初始化时登记窗口，之后焦点、最大化与全屏变化都通过同一个事件回传。
    electron.ipcMain.on(Channel.SIYUAN_EVENT, (event) => {
        if (isHandshaken(event.sender.id)) {
            return;
        }
        markHandshaken(event.sender.id);
        const currentWindow = getWindowByContentId(event.sender.id);
        if (!currentWindow) {
            return;
        }
        markActiveWindow(currentWindow);
        applyMacAppMenuForWindow(currentWindow);
        const webContentsId = currentWindow.webContents.id;
        currentWindow.on("closed", () => {
            forgetAppMenuWebContents(webContentsId);
        });
        currentWindow.on("focus", () => {
            event.sender.send(Channel.SIYUAN_EVENT, "focus");
            markActiveWindow(currentWindow);
            applyMacAppMenuForWindow(currentWindow);
        });
        currentWindow.on("blur", () => {
            event.sender.send(Channel.SIYUAN_EVENT, "blur");
        });
        if ("darwin" !== process.platform) {
            currentWindow.on("maximize", () => {
                event.sender.send(Channel.SIYUAN_EVENT, "maximize");
            });
            currentWindow.on("unmaximize", () => {
                event.sender.send(Channel.SIYUAN_EVENT, "unmaximize");
            });
        }
        currentWindow.on("enter-full-screen", () => {
            event.sender.send(Channel.SIYUAN_EVENT, "enter-full-screen");
        });
        currentWindow.on("leave-full-screen", () => {
            event.sender.send(Channel.SIYUAN_EVENT, "leave-full-screen");
        });
    });

    electron.ipcMain.on(Channel.SIYUAN_FIRST_QUIT, () => {
        electron.app.exit();
    });
};

export {registerAppEventIpc};
