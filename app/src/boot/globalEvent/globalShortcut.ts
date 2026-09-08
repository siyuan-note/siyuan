import type {App} from "../../index";
import {Constants} from "../../constants";
import {isWindow} from "../../util/functions";
import {clearDisallowedTextInputHotkey} from "../../util/hotKeyPolicy";
import {getKeymapBindings} from "../../util/keymapBindings";
import {syncAppMenuShortcuts} from "./commonHotkey";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export const sendGlobalShortcut = (app: App) => {
    /// #if !BROWSER
    if (document.activeElement?.matches(".config-keymap__record, #searchByKey")) {
        sendUnregisterGlobalShortcut(app);
        return;
    }
    syncAppMenuShortcuts();
    if (isWindow()) {
        return;
    }
    const toggleHotkeys = getKeymapBindings(window.siyuan.config.keymap.general.toggleWin)
        .map(clearDisallowedTextInputHotkey).filter(Boolean);
    const hotkeys = new Set(toggleHotkeys);
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            if (command.globalCallback) {
                getKeymapBindings(window.siyuan.config.keymap.plugin?.[plugin.name]?.[command.langKey] ||
                    {custom: command.customHotkey}).forEach(key => {
                    const hotkey = clearDisallowedTextInputHotkey(key);
                    if (hotkey) {
                        hotkeys.add(hotkey);
                    }
                });
            }
        });
    });
    ipcRenderer.send(Constants.SIYUAN_HOTKEY, {
        languages: window.siyuan.languages["_trayMenu"],
        hotkeys: Array.from(hotkeys),
        toggleHotkeys,
    });
    /// #endif
};

export const sendUnregisterGlobalShortcut = (app: App) => {
    /// #if !BROWSER
    if (app) {
        syncAppMenuShortcuts(true);
        if (!isWindow()) {
            ipcRenderer.send(Constants.SIYUAN_HOTKEY, {hotkeys: [], suspended: true});
        }
    }
    /// #endif
};
