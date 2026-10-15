import type {App} from "../index";
import {matchHotKey} from "../protyle/util/hotKey";
import {captureCommandContext} from "./context";
import {execByCommand} from "./executor";
import {DATABASE_ROW_COMMANDS, getDatabaseRowNavigationButton} from "./databaseRowNavigation";

export const handleDatabaseRowShortcut = (app: App, event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) {
        return false;
    }
    const command = DATABASE_ROW_COMMANDS.find(key => matchHotKey(window.siyuan.config.keymap.general[key], event));
    if (!command) {
        return false;
    }
    const context = captureCommandContext({app, source: "shortcut"});
    if (!getDatabaseRowNavigationButton(context, command)) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
        void execByCommand({command, app, context});
    }
    return true;
};
