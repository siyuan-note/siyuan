import type {App} from "../../index";
import {execByCommand} from "../../command/executor";
import {matchHotKey} from "../../protyle/util/hotKey";
import {getCurrentEditor} from "../editor";
import {filterHotkey} from "../../boot/globalEvent/commonHotkey";
import {captureShortcutContext, dispatchPluginShortcut} from "../../command/shortcutRuntime";
import {handleDocumentBoundaryHotkey} from "../../protyle/util/documentBoundaryHotkey";
import {handleDatabaseRowShortcut} from "../../command/databaseRowShortcut";
import {DATABASE_ROW_COMMANDS} from "../../command/databaseRowNavigation";

export const mobileKeydown = (app: App, event: KeyboardEvent) => {
    // 移动端输入框默认填充无 event.key
    if (!event.key || event.defaultPrevented || filterHotkey(event, app)) {
        return;
    }
    if (handleDatabaseRowShortcut(app, event)) {
        return;
    }
    const editor = getCurrentEditor();
    if (editor?.protyle.element.contains(event.target as Node) && handleDocumentBoundaryHotkey(editor.protyle, event)) {
        return;
    }
    const matchGeneral = Object.keys(window.siyuan.config.keymap.general).sort().find((key) => {
        // 上下文菜单由当前编辑器或数据库处理，未处理时继续分发快捷键。
        if (key === "openContextMenu") {
            return false;
        }
        // 跳过桌面页签菜单和已由预览上下文处理的条目导航。
        if (key === "switchTab" || DATABASE_ROW_COMMANDS.some(command => command === key)) {
            return false;
        }
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
