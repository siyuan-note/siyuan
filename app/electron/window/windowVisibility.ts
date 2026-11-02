// 窗口显隐切换：显示、最小化隐藏与主窗口开关。
import type {BrowserWindow} from "electron";
import {hasTray} from "../shared/traySupport";

const showWindow = (wnd: BrowserWindow | null | undefined): void => {
    if (!wnd || wnd.isDestroyed()) {
        return;
    }

    if (wnd.isMinimized()) {
        wnd.restore();
    }
    wnd.show();
};

const hideWindow = (wnd: BrowserWindow): void => {
    // 通过 `Alt+M` 最小化后焦点回到先前的窗口 https://github.com/siyuan-note/siyuan/issues/7275
    wnd.minimize();
    // macOS 无法从 Dock 恢复隐藏的窗口，因此只在有托盘时隐藏。
    if (hasTray(process.platform)) {
        wnd.hide();
    }
};

const toggleMainWindow = (mainWindow: BrowserWindow | null | undefined): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.show(); // 按 `Alt+M` 后隐藏窗口，再次按 `Alt+M` 显示窗口后会卡住不能编辑 https://github.com/siyuan-note/siyuan/issues/8456
    } else if (mainWindow.isVisible()) {
        if (!mainWindow.isFocused()) {
            mainWindow.show();
        } else {
            hideWindow(mainWindow);
        }
    } else {
        mainWindow.show();
    }
};

export {showWindow, hideWindow, toggleMainWindow};
