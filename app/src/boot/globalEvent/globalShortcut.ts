import type {App} from "../../index";
import {Constants} from "../../constants";
import {isWindow} from "../../util/functions";
import {clearDisallowedTextInputHotkey} from "../../util/hotKeyPolicy";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export const sendGlobalShortcut = (app: App) => {
    /// #if !BROWSER
    if (isWindow()) {
        return;
    }
    const hotkeys = [clearDisallowedTextInputHotkey(window.siyuan.config.keymap.general.toggleWin.custom)];
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            if (command.globalCallback && command.customHotkey) {
                const hotkey = clearDisallowedTextInputHotkey(command.customHotkey);
                if (hotkey) {
                    hotkeys.push(hotkey);
                }
            }
        });
    });
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
        languages: window.siyuan.languages["_trayMenu"],
        hotkeys
    });
    /// #endif
};

export const sendUnregisterGlobalShortcut = (app: App) => {
    /// #if !BROWSER
    if (isWindow()) {
        return;
    }
    ipcRenderer.send(Constants.SIYUAN_CMD, {
        cmd: "unregisterGlobalShortcut",
        accelerator: window.siyuan.config.keymap.general.toggleWin.custom
    });
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            if (command.globalCallback) {
                ipcRenderer.send(Constants.SIYUAN_CMD, {
                    cmd: "unregisterGlobalShortcut",
                    accelerator: command.customHotkey
                });
            }
        });
    });
    /// #endif
};
