import type {App} from "../../index";
import {ensureCommandSystem, execByCommand} from "../../command/executor";
import {matchHotKey} from "../../protyle/util/hotKey";
import {getCurrentEditor} from "../editor";
import {filterHotkey} from "../../boot/globalEvent/commonHotkey";
import {captureShortcutContext, dispatchPluginShortcut, dispatchSharedShortcut} from "../../command/shortcutRuntime";

export const mobileKeydown = (app: App, event: KeyboardEvent) => {
    // 移动端输入框默认填充无 event.key
    if (!event.key || filterHotkey(event, app)) {
        return;
    }
    if (dispatchSharedShortcut(app, event, () => ensureCommandSystem(app))) {
        return;
    }
    const matchGeneral = Object.keys(window.siyuan.config.keymap.general).find((key) => {
        if (matchHotKey(window.siyuan.config.keymap.general[key], event)) {
            const protyle = getCurrentEditor()?.protyle;
            if (protyle) {
                execByCommand({command: key, app, protyle, previousRange: protyle.toolbar.range});
            }
            return true;
        }
    });

    if (matchGeneral) {
        event.preventDefault();
        return;
    }

    return dispatchPluginShortcut(app, event, "shortcut", () => captureShortcutContext(app, event));
};
