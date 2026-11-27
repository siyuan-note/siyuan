import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/globalShortcut";
import {updateDockHotkeys} from "../../layout/dock/util";
import {syncAppMenuShortcuts} from "../../boot/globalEvent/commonHotkey";
import {isSettingsWindow} from "../setting/windowContext";
import {getAllEditor} from "../../layout/getAll";
import {syncMarkdownKeymap} from "../../markdown/keymapSync";
import {syncPluginCommandKeymap} from "../../plugin/keymap";

export const applyKeymap = (data: Config.IKeymap) => {
    window.siyuan.config.keymap = data;
    if (isSettingsWindow()) {
        return;
    }
    syncMarkdownKeymap();
    sendUnregisterGlobalShortcut(window.siyuan.ws.app);
    syncPluginCommandKeymap(window.siyuan.ws.app.plugins);
    updateDockHotkeys();
    getAllEditor().forEach(editor => editor.protyle.scroll?.updateHotkeyLabels());
    sendGlobalShortcut(window.siyuan.ws.app);
    syncAppMenuShortcuts(Boolean(document.activeElement?.matches(".config-keymap__record, #searchByKey")));
};
