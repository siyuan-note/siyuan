import * as electron from "electron";
import type {
    BrowserWindow,
    IpcMainEvent,
} from "electron";
import type {KernelTarget} from "../shared/types";
import {Channel} from "../shared/channels";

type WindowMessagePayload = {cmd: string; data?: unknown};
type WindowTabChildren = {instance?: unknown; blockId?: unknown; notebookId?: unknown};
type WindowTabData = {id?: unknown; children?: WindowTabChildren};

type DispatchWindowMessageOptions = {
    senderWebContentsId: number;
    getKernelTarget: (webContentsId: number) => KernelTarget | undefined;
    getAllWindows: () => BrowserWindow[];
};

// 窗口间消息（siyuan-send-windows）的授权与投递规则。渲染进程只能发送本表列出的命令，
// 主进程内部通知（如 lockscreenByMode）不在此列，因此任何渲染进程都无法伪造。
const rendererWindowCommands = new Set(["closetab", "setTabDragData", "resetTabsStyle", "moveTabToMainWindow"]);

const isRendererWindowCommand = (data: unknown): data is WindowMessagePayload => {
    if (!data || typeof data !== "object" || typeof (data as WindowMessagePayload).cmd !== "string") {
        return false;
    }
    const message = data as WindowMessagePayload;
    if (!rendererWindowCommands.has(message.cmd)) {
        return false;
    }
    if (message.cmd === "moveTabToMainWindow") {
        const tab = message.data as WindowTabData | undefined;
        const children = tab?.children;
        return !!tab && typeof tab.id === "string" && !!tab.id && children?.instance === "Editor" &&
            typeof children.blockId === "string" && !!children.blockId &&
            (children.notebookId === undefined || typeof children.notebookId === "string");
    }
    return message.cmd === "setTabDragData" ? !!message.data && typeof message.data === "object" : typeof message.data === "string";
};

// 仅允许同工作区窗口之间投递：发送方必须是已登记的窗口，收件方必须与发送方指向同一内核目标。
// 这样远端内核窗口无法影响其他工作区，本地发送方也无法影响另一个工作区
const dispatchWindowMessage = (data: unknown, {
    senderWebContentsId, getKernelTarget, getAllWindows,
}: DispatchWindowMessageOptions): boolean => {
    if (!isRendererWindowCommand(data)) {
        return false;
    }
    const senderTarget = getKernelTarget(senderWebContentsId);
    if (!senderTarget) {
        return false;
    }
    getAllWindows().forEach((window: BrowserWindow) => {
        if (window.isDestroyed()) {
            return;
        }
        const webContentsId = window.webContents.id;
        if (webContentsId === senderWebContentsId) {
            return;
        }
        const target = getKernelTarget(webContentsId);
        if (!target || target.origin !== senderTarget.origin) {
            return;
        }
        window.webContents.send(Channel.SIYUAN_SEND_WINDOWS, data);
    });
    return true;
};

// 主进程把跨窗口消息转发给 dispatchWindowMessage，并补齐发送方与内核目标。
const registerWindowMessageHandler = (getWindowKernelTarget: (webContentsId: number) => KernelTarget | undefined): void => {
    electron.ipcMain.on(Channel.SIYUAN_SEND_WINDOWS, (event: IpcMainEvent, data: unknown) => {
        dispatchWindowMessage(data, {
            senderWebContentsId: event.sender.id,
            getKernelTarget: getWindowKernelTarget,
            getAllWindows: () => electron.BrowserWindow.getAllWindows(),
        });
    });
};

export {dispatchWindowMessage, registerWindowMessageHandler};
