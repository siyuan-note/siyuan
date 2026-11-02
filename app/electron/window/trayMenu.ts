import * as electron from "electron";
import {state} from "../shared/runtime";
import {hasTray} from "../shared/traySupport";
import {hideWindow} from "./windowVisibility";
import type {BrowserWindow, Tray} from "electron";
import {Channel} from "../shared/channels";
type TrayMenuLabels = Record<string, string>;

// 显示/隐藏切换同时刷新菜单文案，托盘标签依赖窗口的可见状态与置顶状态。
const showHideWindow = (tray: Tray, lang: TrayMenuLabels, mainWindow: BrowserWindow | undefined): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    if (!mainWindow.isVisible()) {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.show();
    } else {
        hideWindow(mainWindow);
    }

    resetTrayMenu(tray, lang, mainWindow);
};

const resetTrayMenu = (tray: Tray, lang: TrayMenuLabels, mainWindow: BrowserWindow | undefined): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const trayMenuTemplate: electron.MenuItemConstructorOptions[] = [{
        label: mainWindow.isVisible() ? lang.hideWindow : lang.showWindow, click: () => {
            showHideWindow(tray, lang, mainWindow);
        },
    }, {
        label: lang.officialWebsite, click: () => {
            electron.shell.openExternal("https://b3log.org/siyuan/");
        },
    }, {
        label: lang.openSource, click: () => {
            electron.shell.openExternal("https://github.com/siyuan-note/siyuan");
        },
    }, {
        label: lang.resetWindow, type: "checkbox", click: (v: {checked: boolean}) => {
            state.exit.resetWindowStateOnRestart = v.checked;
            mainWindow.webContents.send(Channel.SIYUAN_SAVE_CLOSE, true);
        },
    }, {
        label: lang.quit, click: () => {
            mainWindow.webContents.send(Channel.SIYUAN_SAVE_CLOSE, true);
        },
    },];

    if ("win32" === process.platform) {
        // Windows 端支持窗口置顶 https://github.com/siyuan-note/siyuan/issues/6860
        trayMenuTemplate.splice(1, 0, {
            label: mainWindow.isAlwaysOnTop() ? lang.cancelWindowTop : lang.setWindowTop, click: () => {
                if (!mainWindow.isAlwaysOnTop()) {
                    mainWindow.setAlwaysOnTop(true, "pop-up-menu");
                } else {
                    mainWindow.setAlwaysOnTop(false);
                }
                resetTrayMenu(tray, lang, mainWindow);
            },
        });
    }
    const contextMenu = electron.Menu.buildFromTemplate(trayMenuTemplate);
    tray.setContextMenu(contextMenu);
};

// 工作空间初始化时创建托盘；非 Windows/Linux 平台没有托盘。
const createWorkspaceTray = (iconPath: string): Tray | undefined => {
    if (!hasTray(process.platform)) {
        return undefined;
    }
    return new electron.Tray(iconPath);
};

export {resetTrayMenu, showHideWindow, createWorkspaceTray};
