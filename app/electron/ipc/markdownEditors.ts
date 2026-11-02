// 桌面主菜单「新建 Markdown 文件」的入口：只接受已初始化工作空间的主框架请求。
import * as electron from "electron";
import {APP_PAGE} from "../shared/pagePaths";
import {isSystemShuttingDown, state, writeLog} from "../shared/runtime";
import {getWindowKernelTarget, isWindowInitialized} from "../window/windowRegistry";
import {isMarkdownBusy, openMarkdownEditor, openMarkdownAsset} from "../startup/markdownEditors";
import {normalizeMarkdownAsset, verifyMarkdownAssetPath} from "./markdownAsset";
import type {IpcMainEvent, IpcMainInvokeEvent} from "electron";
import {Channel} from "../shared/channels";

// Both entry points require a live workspace main frame. Asset paths are resolved separately below.
const authorizedWorkspace = (event: IpcMainEvent | IpcMainInvokeEvent) => {
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
    return state.workspaces.find(workspace => workspace.webContentsId === event.sender.id);
};

const handleOpenMarkdown = (event: IpcMainEvent): void => {
    if (authorizedWorkspace(event)) openMarkdownEditor();
};

const handleOpenAsset = async (event: IpcMainInvokeEvent, value: unknown): Promise<boolean> => {
    const workspace = authorizedWorkspace(event);
    const asset = normalizeMarkdownAsset(value);
    if (!workspace || workspace.kernelTarget.mode !== "local" || !workspace.workspaceDir || !asset) return false;
    const origin = workspace.kernelTarget.origin;
    const directory = workspace.workspaceDir;
    try {
        const response = await event.sender.session.fetch(origin + "/api/asset/resolveAssetPath", {
            method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path: asset}),
            credentials: "include", redirect: "error", signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return false;
        const result = await response.json();
        if (result.code !== 0) return false;
        const file = await verifyMarkdownAssetPath(directory, result.data);
        if (authorizedWorkspace(event) !== workspace || workspace.kernelTarget.mode !== "local" ||
            workspace.kernelTarget.origin !== origin || workspace.workspaceDir !== directory) return false;
        await openMarkdownAsset(file);
        return true;
    } catch {
        writeLog("open local Markdown asset failed");
        return false;
    }
};

const registerMarkdownIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_OPEN_MARKDOWN, handleOpenMarkdown);
    electron.ipcMain.handle(Channel.SIYUAN_OPEN_MARKDOWN, handleOpenAsset);
};

export {registerMarkdownIpc};
