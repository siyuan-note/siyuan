// 原生对话框、文件选择、右键菜单与拼写检查：只做渲染进程请求到 Electron 原生能力的转发。
import * as electron from "electron";
import {applySpellcheckAction, requestContextMenu, requestSpellcheckContext} from "../window/contextMenu";
import type {BrowserWindow} from "electron";
import {Channel} from "../shared/channels";

type OpenDialogResult = {canceled: boolean; filePaths: string[]};

// 同一窗口的同名单选对话框只允许一个在途，避免连点叠加多个系统对话框。
const openDialogSingletons = new Set<string>();

const showOpenDialog = (senderId: number, data: {
    cmd?: unknown; singleton?: unknown; [key: string]: unknown;
}): Promise<OpenDialogResult> | OpenDialogResult => {
    if (!data.singleton) {
        return electron.dialog.showOpenDialog(data as Electron.OpenDialogOptions);
    }
    const singleton = `${senderId}:${data.singleton}`;
    if (openDialogSingletons.has(singleton)) {
        return {canceled: true, filePaths: []};
    }
    openDialogSingletons.add(singleton);
    const options = {...data};
    // 内部字段不能传给 Electron 的对话框选项。
    delete options.cmd;
    delete options.singleton;
    return electron.dialog.showOpenDialog(options as Electron.OpenDialogOptions).finally(() => {
        openDialogSingletons.delete(singleton);
    });
};

const showSaveDialog = (data: Record<string, unknown>) =>
    electron.dialog.showSaveDialog(data as Electron.SaveDialogOptions);

// 发送方窗口可能已经销毁，退回当前焦点窗口；两者都没有时改用无父窗口对话框。
const showMessageBoxSync = (sender: Electron.WebContents, options: Electron.MessageBoxSyncOptions): number => {
    const parentWindow: BrowserWindow | null = electron.BrowserWindow.fromWebContents(sender) ||
        electron.BrowserWindow.getFocusedWindow();
    return parentWindow ? electron.dialog.showMessageBoxSync(parentWindow, options) :
        electron.dialog.showMessageBoxSync(options);
};

const registerDialogIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_CONTEXT_MENU, (event, langs) => requestContextMenu(event.sender, langs));
    electron.ipcMain.on(Channel.SIYUAN_SPELLCHECK_CONTEXT, (event, position) => requestSpellcheckContext(event.sender, position));
    electron.ipcMain.handle(Channel.SIYUAN_SPELLCHECK_ACTION, (event, data) => applySpellcheckAction(event.sender, data));
    electron.ipcMain.on(Channel.SIYUAN_CONFIRM_DIALOG, (event, options) => {
        event.returnValue = showMessageBoxSync(event.sender, options);
    });
    electron.ipcMain.on(Channel.SIYUAN_ALERT_DIALOG, (event, options) => {
        showMessageBoxSync(event.sender, options);
        event.returnValue = undefined;
    });
};

export {registerDialogIpc, showOpenDialog, showSaveDialog};
