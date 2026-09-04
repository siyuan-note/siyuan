import type {App} from "../../index";
import {execByCommand} from "../../command/executor";
import {matchHotKey} from "../../protyle/util/hotKey";
import {getCurrentEditor} from "../editor";
import {filterHotkey} from "../../boot/globalEvent/commonHotkey";
import {captureCommandContext} from "../../command/context";
import {resolvePluginCommandCallback} from "../../plugin/commandAdapter";

export const mobileKeydown = (app: App, event: KeyboardEvent) => {
    // 移动端输入框默认填充无 event.key
    if (!event.key || filterHotkey(event, app)) {
        return;
    }
    const matchGeneral = Object.keys(window.siyuan.config.keymap.general).find((key) => {
        if (matchHotKey(window.siyuan.config.keymap.general[key].custom, event)) {
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

    let matchCommand = false;
    const commandContext = captureCommandContext({app, source: "shortcut"});
    app.plugins.find(item => {
        item.commands.find(command => {
            const callback = resolvePluginCommandCallback(command, commandContext);
            if (callback && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                void callback();
                return true;
            }
        });
        if (matchCommand) {
            return true;
        }
    });
    if (matchCommand) {
        event.preventDefault();
        return true;
    }
};
