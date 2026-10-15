import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/globalShortcut";
import {updateDockHotkeys} from "../../layout/dock/util";
import {syncAppMenuShortcuts} from "../../boot/globalEvent/commonHotkey";
import {isSettingsWindow} from "../setting/windowContext";
import {getAllEditor} from "../../layout/getAll";

export const applyKeymap = (data: Config.IKeymap) => {
    window.siyuan.config.keymap = data;
    if (isSettingsWindow()) {
        return;
    }
    sendUnregisterGlobalShortcut(window.siyuan.ws.app);
    window.siyuan.ws.app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            command.customHotkey = data.plugin?.[plugin.name]?.[command.langKey]?.custom || "";
        });
    });
    updateDockHotkeys();
    getAllEditor().forEach(editor => editor.protyle.scroll?.updateHotkeyLabels());
    sendGlobalShortcut(window.siyuan.ws.app);
    syncAppMenuShortcuts(Boolean(document.activeElement?.matches(".config-keymap__record, #searchByKey")));
};
