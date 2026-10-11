import {openAttr} from "../../menus/commonMenuItem";
import {hasClosestBlock} from "./hasClosest";
import {getTopAloneElement} from "../wysiwyg/getBlock";
import {matchHotKey} from "./hotKey";

// 只读正文的属性快捷键仅打开面板，不将选中文本写入命名。
export const handleReadonlyAttributeHotkey = (protyle: IProtyle, event: KeyboardEvent): boolean => {
    if (!protyle.disabled || event.isComposing ||
        !protyle.wysiwyg.element.contains(event.target as Node) ||
        (event.target as Element).closest(".protyle-action, .tabs-header, input, textarea, button") ||
        !matchHotKey(window.siyuan.config.keymap.editor.general.attr, event)) {
        return false;
    }
    const selection = getSelection();
    if (!selection?.rangeCount) {
        return false;
    }
    const range = selection.getRangeAt(0);
    if (!protyle.wysiwyg.element.contains(range.commonAncestorContainer)) {
        return false;
    }
    const block = hasClosestBlock(range.startContainer);
    if (!block || protyle.lite || block.getAttribute("data-type") === "NodeThematicBreak") {
        return false;
    }
    const selected = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    openAttr(selected.length === 1 ? selected[0] : getTopAloneElement(block), "bookmark", protyle);
    event.preventDefault();
    event.stopPropagation();
    return true;
};
