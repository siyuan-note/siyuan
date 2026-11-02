// `siyuan-get` 的窗口命令：几何状态、窗口级开关、窗口工作空间登记与文件对话框。
import * as electron from "electron";
import {writeLog} from "../shared/runtime";
import {WINDOW_PAGE} from "../shared/pagePaths";
import {getWindowByContentId} from "../window/windowLookup";
import {showWindow} from "../window/windowVisibility";
import {getWindowPathname} from "../window/windowNavigation";
import {showOpenDialog, showSaveDialog} from "./dialogs";
import {flushWindowWorkspaces, windowWorkspaces} from "../window/windowWorkspaces";
import {captureWindowGeometry, restoreWindowGeometry} from "../window/windowGeometry";
import type {BrowserWindow} from "electron";
import type {GetHandler} from "./getContract";
import {Channel} from "../shared/channels";

const getWindowGeometry: GetHandler = ({data, window, kernelTarget, isMainFrame}) => {
    if (!window || !kernelTarget || !isMainFrame) {
        return false;
    }
    return data.cmd === "getWindowGeometry" ? captureWindowGeometry(window) :
        restoreWindowGeometry(window, data.geometry, electron.screen);
};

const getContentsId: GetHandler = ({event}) => event.sender.id;

const isAlwaysOnTop: GetHandler = ({window}) => window ? window.isAlwaysOnTop() : false;

const isFullScreen: GetHandler = ({window}) => window ? window.isFullScreen() : false;

const isMaximized: GetHandler = ({window}) => window ? window.isMaximized() : false;

const WINDOW_WORKSPACE_COMMANDS = new Set<string>([
    Channel.SIYUAN_WINDOW_WORKSPACE_SET, Channel.SIYUAN_WINDOW_WORKSPACE_FOCUS,
    Channel.SIYUAN_WINDOW_WORKSPACE_GET_OPEN, Channel.SIYUAN_WINDOW_WORKSPACE_FLUSH_ALL,
]);

const windowWorkspace: GetHandler = ({data, window, kernelTarget}) => {
    if (!WINDOW_WORKSPACE_COMMANDS.has(data.cmd) || !kernelTarget) {
        return false;
    }
    if (data.cmd === Channel.SIYUAN_WINDOW_WORKSPACE_GET_OPEN) {
        return windowWorkspaces.list(kernelTarget.origin);
    }
    if (data.cmd === Channel.SIYUAN_WINDOW_WORKSPACE_FLUSH_ALL) {
        return flushWindowWorkspaces(windowWorkspaces.list(kernelTarget.origin)
            .map((id: string) => windowWorkspaces.get(kernelTarget.origin, id)).filter(Boolean) as BrowserWindow[]);
    }
    if (data.cmd === Channel.SIYUAN_WINDOW_WORKSPACE_FOCUS) {
        const target = windowWorkspaces.get(kernelTarget.origin, data.id as string);
        if (target) {
            showWindow(target);
            return true;
        }
        return false;
    }
    if (!window || getWindowPathname(window) !== WINDOW_PAGE) {
        return false;
    }
    return windowWorkspaces.associate(window, kernelTarget.origin, data.id as string);
};

const printToPDF: GetHandler = ({data}) => {
    // 同一虚拟打印机配置在多个窗口之间共享，这里显式指向目标窗口。
    const target = getWindowByContentId(data.webContentsId as number) as BrowserWindow;
    try {
        return target.webContents.printToPDF(data.pdfOptions as Electron.PrintToPDFOptions);
    } catch (e) {
        writeLog("printToPDF: " + e);
        throw e;
    }
};

// 同一内核下同一文档已打开时把焦点交给那个窗口，而不是再开一个。
const openFile: GetHandler = ({event, data}) => {
    const options = JSON.parse(data.options as string);
    return electron.BrowserWindow.getAllWindows().some((item: BrowserWindow) => {
        if (item.isDestroyed() || item.webContents.isDestroyed() ||
            item.webContents.id === event.sender.id) {
            return false;
        }

        let url: URL;
        let ids: string[];
        try {
            const currentURL = item.webContents.getURL();
            if (!currentURL) {
                return false;
            }
            url = new URL(currentURL);
            ids = decodeURIComponent(url.hash.substring(1)).split("\u200b");
        } catch {
            return false;
        }
        if (data.port !== url.port) {
            return false;
        }
        if (ids.includes(options.rootID) || ids.includes(options.assetPath)) {
            item.focus();
            item.webContents.send(Channel.SIYUAN_OPEN_FILE, options);
            return true;
        }
        return false;
    });
};

const windowCommandHandlers: Record<string, GetHandler> = {
    "getWindowGeometry": getWindowGeometry,
    "setWindowGeometry": getWindowGeometry,
    "getContentsId": getContentsId,
    "isAlwaysOnTop": isAlwaysOnTop,
    "isFullScreen": isFullScreen,
    "isMaximized": isMaximized,
    "printToPDF": printToPDF,
    [Channel.SIYUAN_OPEN_FILE]: openFile,
    [Channel.SIYUAN_WINDOW_WORKSPACE_SET]: windowWorkspace,
    [Channel.SIYUAN_WINDOW_WORKSPACE_FOCUS]: windowWorkspace,
    [Channel.SIYUAN_WINDOW_WORKSPACE_GET_OPEN]: windowWorkspace,
    [Channel.SIYUAN_WINDOW_WORKSPACE_FLUSH_ALL]: windowWorkspace,
    "showOpenDialog": ({event, data}) => showOpenDialog(event.sender.id, data),
    "showSaveDialog": ({data}) => showSaveDialog(data),
};

export {windowCommandHandlers};
