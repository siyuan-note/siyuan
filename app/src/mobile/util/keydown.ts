import {App} from "../../index";
import {execByCommand} from "../../boot/globalEvent/commandPanel";
import {matchHotKey} from "../../protyle/util/hotKey";
import {getCurrentEditor} from "../editor";
import {filterHotkey} from "../../boot/globalEvent/commonHotkey";

export const mobileKeydown = (app: App, event: KeyboardEvent) => {
    if (filterHotkey(event, app)) {
        return;
    }
    const protyle = getCurrentEditor().protyle;
    const matchGeneral = Object.keys(window.siyuan.config.keymap.general).find((key) => {
        if (matchHotKey(window.siyuan.config.keymap.general[key].custom, event)) {
            execByCommand({command: key, app, protyle, previousRange: protyle.toolbar.range});
            return true;
        }
    });

    if (matchGeneral) {
        event.preventDefault();
        return;
    }

    let matchCommand = false;
    app.plugins.find(item => {
        item.commands.find(command => {
            if (command.callback &&
                !command.fileTreeCallback && !command.editorCallback && !command.dockCallback && !command.globalCallback
                && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                command.callback();
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
