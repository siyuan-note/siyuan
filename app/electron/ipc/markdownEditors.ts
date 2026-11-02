// 桌面主菜单「新建 Markdown 文件」的入口：只接受已初始化工作空间的主框架请求。
import * as electron from "electron";
import {APP_PAGE} from "../shared/pagePaths";
import {isSystemShuttingDown, state, writeLog} from "../shared/runtime";
import {getWindowKernelTarget, isWindowInitialized} from "../window/windowRegistry";
import {isMarkdownBusy, openMarkdownEditor} from "../startup/markdownEditors";
import type {IpcMainEvent} from "electron";
import {Channel} from "../shared/channels";

// 文件授权由轻量窗口自己的原生选择器完成，这里只允许新建本机编辑窗口。
const handleOpenMarkdown = (event: IpcMainEvent): void => {
    const target = getWindowKernelTarget(event.sender.id);
    if (!target || event.senderFrame !== event.sender.mainFrame || !isWindowInitialized(event.sender.id) ||
        !state.workspaces.some(workspace => workspace.webContentsId === event.sender.id) ||
        state.exit.updateInstall || isSystemShuttingDown() || isMarkdownBusy()) {
        return;
    }
    try {
        const url = new URL(event.senderFrame.url);
        if (url.origin !== target.origin || url.pathname !== APP_PAGE) {
            return;
        }
    } catch {
        writeLog("rejected open Markdown request from an unparsable frame");
        return;
    }
    openMarkdownEditor();
};

const registerMarkdownIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_OPEN_MARKDOWN, handleOpenMarkdown);
};

export {registerMarkdownIpc};
