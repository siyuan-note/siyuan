import {matchHotKey} from "./hotKey";
import {goEnd, goHome} from "../wysiwyg/commonHotkey";
import {hideElements} from "../ui/hideElements";

export const handleDocumentBoundaryHotkey = (protyle: IProtyle, event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || event.isComposing ||
        target.closest("input, textarea, select, button, [role=\"tab\"], [role=\"checkbox\"], .tabs-header, .protyle-action") ||
        !protyle.wysiwyg.element.firstElementChild) {
        return false;
    }
    const keymap = window.siyuan.config.keymap.editor.general;
    if (matchHotKey(keymap.goToDocumentStart, event)) {
        goHome(protyle);
    } else if (matchHotKey(keymap.goToDocumentEnd, event)) {
        goEnd(protyle);
    } else {
        return false;
    }
    hideElements(["hint", "select"], protyle);
    event.stopPropagation();
    event.preventDefault();
    return true;
};
