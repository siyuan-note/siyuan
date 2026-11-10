// 桌面外壳集成：全局快捷键、托盘文案与开机启动。
import * as electron from "electron";
import {state, getConsole} from "../shared/runtime";
import {hasTray} from "../shared/traySupport";
import {hideWindow, toggleMainWindow} from "../window/windowVisibility";
import {resetTrayMenu} from "../window/trayMenu";
import {updateGlobalShortcutBindings} from "../window/globalShortcutBindings";
import {hotKey2Electron} from "../window/appMenu";
import {getActiveWindow, getWindowKernelTarget} from "../window/windowRegistry";
import {Channel} from "../shared/channels";

const registerShellIntegrationIpc = (): void => {
    electron.ipcMain.on(Channel.SIYUAN_HOTKEY, (event, data) => {
        if (!Array.isArray(data.hotkeys)) {
            return;
        }
        const ownerWorkspace = state.workspaces.find(workspaceItem =>
            event.sender.id === workspaceItem.browserWindow.webContents.id);
        if (!ownerWorkspace) {
            return;
        }
        const failed = updateGlobalShortcutBindings(ownerWorkspace, data, {
            workspaces: state.workspaces,
            globalShortcut: electron.globalShortcut,
            convert: hotKey2Electron,
            getActiveId: () => {
                const activeWindow = getActiveWindow();
                return activeWindow && !activeWindow.isDestroyed() ? activeWindow.webContents.id : undefined;
            },
            toggle: workspace => {
                toggleMainWindow(workspace.browserWindow);
                if (hasTray(process.platform)) {
                    resetTrayMenu(workspace.tray as electron.Tray,
                        workspace.hotkeyLanguages as Record<string, string>, workspace.browserWindow);
                }
            },
            dispatch: (workspace, hotkey) => workspace.browserWindow.webContents.send(Channel.SIYUAN_HOTKEY, {hotkey}),
            reportError: error => getConsole().error("Global shortcut registration failed:", error),
        });
        event.sender.send(Channel.SIYUAN_HOTKEY, {failed});
    });

    // 前端在语言变化时提交新的托盘文案，这里据此重建菜单。
    electron.ipcMain.on(Channel.SIYUAN_CONFIG_TRAY, (event, data) => {
        state.workspaces.find(item => {
            if (item.browserWindow.webContents.id === event.sender.id) {
                hideWindow(item.browserWindow);
                if (hasTray(process.platform)) {
                    resetTrayMenu(item.tray as electron.Tray, data.languages, item.browserWindow);
                }
                return true;
            }
        });
    });

    electron.ipcMain.on(Channel.SIYUAN_AUTO_LAUNCH, (event, data) => {
        const kernelTarget = getWindowKernelTarget(event.sender.id);
        const args = [];
        if (kernelTarget?.mode === "remote") {
            args.push("--remote=" + kernelTarget.origin);
        }
        if (data.openAsHidden) {
            args.push("--openAsHidden");
        }
        electron.app.setLoginItemSettings({
            openAtLogin: data.openAtLogin,
            args,
        });
    });
};

export {registerShellIntegrationIpc};
