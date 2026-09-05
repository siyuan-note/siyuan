import type {App} from "../../index";
import {execByCommand} from "../../command/executor";
import {matchHotKey} from "../../protyle/util/hotKey";
import {getCurrentEditor} from "../editor";
import {filterHotkey} from "../../boot/globalEvent/commonHotkey";
import {captureCommandContext} from "../../command/context";
import {resolvePluginCommandCallback, supportsPluginCommandSource} from "../../plugin/commandAdapter";

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

    let matchedCommand: ICommand | undefined;
    app.plugins.find(item => {
        item.commands.find(command => {
            if (supportsPluginCommandSource(command, "shortcut") && matchHotKey(command.customHotkey, event)) {
                matchedCommand = command;
                return true;
            }
        });
        return Boolean(matchedCommand);
    });
    if (matchedCommand) {
        const commandContext = captureCommandContext({app, source: "shortcut"});
        const callback = resolvePluginCommandCallback(matchedCommand, commandContext);
        if (callback) {
            void callback();
            event.preventDefault();
            return true;
        }
    }
};
