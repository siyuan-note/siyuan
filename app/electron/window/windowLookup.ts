// 查找应用窗口：按 webContents 定位窗口，并按焦点顺序挑出已完成握手的主窗口。
// 账本读写留在 windowRegistry，显隐切换在 windowVisibility，退出编排在 appExit。
import {BrowserWindow} from "electron";
import {state} from "../shared/runtime";
import {getActiveWindow, isHandshaken} from "./windowRegistry";
import type {Workspace} from "../shared/types";

// 主窗口候选必须已完成 `siyuan-event` 握手，未握手的窗口还在启动页阶段。
const isHandshakenAppWindow = (wnd: BrowserWindow | null | undefined): boolean => {
    return !!(wnd && !wnd.isDestroyed() && isHandshaken(wnd.webContents.id));
};

const getWindowByContentId = (webContentsId: number): BrowserWindow | undefined =>
    BrowserWindow.getAllWindows().find((win: BrowserWindow) => win.webContents.id === webContentsId);

const getAppWindow = (): BrowserWindow | null => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && isHandshakenAppWindow(focused)) {
        return focused;
    }
    const latestActiveWindow = getActiveWindow();
    if (latestActiveWindow && isHandshakenAppWindow(latestActiveWindow)) {
        return latestActiveWindow;
    }
    const workspaceWindow = state.workspaces.find((item: Workspace) => isHandshakenAppWindow(item.browserWindow));
    if (workspaceWindow) {
        return workspaceWindow.browserWindow;
    }
    return BrowserWindow.getAllWindows().find(isHandshakenAppWindow) || null;
};

export {isHandshakenAppWindow, getWindowByContentId, getAppWindow};
