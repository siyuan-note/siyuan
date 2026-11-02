// 桌面端 IPC 的组装点：各通道域在自己的模块里注册，这里只按顺序接入并保留共享安装。
import * as electron from "electron";
import {handleGet} from "./getChannel";
import {createWebPageFetcher, installWebPageFetchIPC} from "../remote/webPageFetch";
import {handleDragMessage} from "../window/blockDrag";
import {registerAppEventIpc} from "./appEvents";
import {registerCommandIpc} from "./commandChannel";
import {registerDialogIpc} from "./dialogs";
import {registerExportPreview} from "./exportPreview";
import {registerShellIntegrationIpc} from "./shellIntegration";
import {registerWorkspaceIpc} from "./workspace";
import {beginUpdateInstall} from "../startup/updateCoordination";
import {getWindowKernelTarget, isWindowInitialized} from "../window/windowRegistry";
import {registerWindowMessageHandler} from "../window/windowMessaging";
import type {InitKernel, InitMainWindow} from "../shared/types";
import {Channel} from "../shared/channels";

const registerDesktopIpc = ({initKernel, initMainWindow}: {
    initKernel: InitKernel;
    initMainWindow: InitMainWindow;
}): void => {
    const {ipcMain} = electron;
    registerAppEventIpc();
    registerCommandIpc();
    registerDialogIpc();
    registerShellIntegrationIpc();
    registerExportPreview();
    registerWorkspaceIpc({initKernel, initMainWindow});
    ipcMain.handle(Channel.SIYUAN_INSTALL_UPDATE, (event, data) => beginUpdateInstall(event, data));

    // 抓取窗口使用独立临时会话，创建时机跟随通道注册。
    installWebPageFetchIPC(ipcMain,
        createWebPageFetcher({BrowserWindow: electron.BrowserWindow, session: electron.session}),
        sender => isWindowInitialized(sender.id) && !!getWindowKernelTarget(sender.id));
    ipcMain.handle(Channel.SIYUAN_GET, handleGet);
    ipcMain.on(Channel.SIYUAN_BLOCK_DRAG, (event, data) => handleDragMessage(event.sender.id, data));

    registerWindowMessageHandler(getWindowKernelTarget);
};

export {registerDesktopIpc};
