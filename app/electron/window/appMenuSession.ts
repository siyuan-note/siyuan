import * as electron from "electron";
import {applyMacAppMenu} from "./appMenu";
import {forgetHandshaken, getActiveWindow} from "./windowRegistry";
import {isHandshakenAppWindow} from "./windowLookup";
import type {BrowserWindow} from "electron";

// 前端同步过来的菜单配置形状由 appMenu 决定，这里只负责转交。
type AppMenuSync = Parameters<typeof applyMacAppMenu>[0];

// 渲染进程同步过来的菜单配置按工作空间去重，多窗口共用一个工作空间时只保留一份。
const appMenuByWorkspaceDir = new Map<string, AppMenuSync>();
const appMenuWorkspaceByWebContentsId = new Map<number, string>();

// 窗口销毁时解绑；同一工作空间的其余窗口仍在时保留菜单配置。
const forgetAppMenuWebContents = (webContentsId: number): void => {
    const workspaceDir = appMenuWorkspaceByWebContentsId.get(webContentsId);
    appMenuWorkspaceByWebContentsId.delete(webContentsId);
    forgetHandshaken(webContentsId);
    if (!workspaceDir) {
        return;
    }
    for (const mappedDir of appMenuWorkspaceByWebContentsId.values()) {
        if (mappedDir === workspaceDir) {
            return;
        }
    }
    appMenuByWorkspaceDir.delete(workspaceDir);
};

const applyMacAppMenuForWindow = (wnd: BrowserWindow | undefined): void => {
    if ("darwin" !== process.platform || !wnd || wnd.isDestroyed()) {
        return;
    }
    const workspaceDir = appMenuWorkspaceByWebContentsId.get(wnd.webContents.id);
    if (!workspaceDir) {
        return;
    }
    applyMacAppMenu(appMenuByWorkspaceDir.get(workspaceDir));
};

// 菜单是进程级资源：只有来源窗口就是当前焦点窗口，或与焦点窗口同属一个工作空间时才切换。
const shouldApplyAppMenuFrom = (webContentsId: number, workspaceDir: string): boolean => {
    const focused = electron.BrowserWindow.getFocusedWindow();
    if (focused && isHandshakenAppWindow(focused)) {
        if (focused.webContents.id === webContentsId) {
            return true;
        }
        return appMenuWorkspaceByWebContentsId.get(focused.webContents.id) === workspaceDir;
    }
    const latestActiveWindow = getActiveWindow();
    if (latestActiveWindow && isHandshakenAppWindow(latestActiveWindow)) {
        if (latestActiveWindow.webContents.id === webContentsId) {
            return true;
        }
        const latestWorkspace = appMenuWorkspaceByWebContentsId.get(latestActiveWindow.webContents.id);
        return !latestWorkspace || latestWorkspace === workspaceDir;
    }
    return true;
};

// 登记录入的菜单配置，并仅在应当生效时应用到应用菜单。
const rememberAppMenu = (webContentsId: number, workspaceDir: string, sync: AppMenuSync): void => {
    appMenuByWorkspaceDir.set(workspaceDir, sync);
    appMenuWorkspaceByWebContentsId.set(webContentsId, workspaceDir);
    if (shouldApplyAppMenuFrom(webContentsId, workspaceDir)) {
        applyMacAppMenu(sync);
    }
};

export {
    forgetAppMenuWebContents,
    applyMacAppMenuForWindow,
    rememberAppMenu,
};
