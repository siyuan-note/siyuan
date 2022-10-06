import {getEventName} from "../../protyle/util/compatibility";
import {listIndent, listOutdent} from "../../protyle/wysiwyg/list";
import {hasClosestBlock, hasClosestByMatchTag} from "../../protyle/util/hasClosest";

export const showKeyboardToolbar = (bottom = 0) => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.remove("fn__none");
    toolbarElement.style.bottom = bottom + "px";
};

export const hideKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.add("fn__none");
};

export const initKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.addEventListener(getEventName(), (event) => {
        const target = event.target as HTMLElement;
        const buttonElement = hasClosestByMatchTag(target, "BUTTON");
        if (!buttonElement || !window.siyuan.mobileEditor) {
            return;
        }
        const type = buttonElement.getAttribute("data-type");
        const protyle = window.siyuan.mobileEditor.protyle;
        if (type === "undo") {
            protyle.undo.undo(protyle);
            return;
        }
        if (type === "redo") {
            protyle.undo.redo(protyle);
            return;
        }
        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        if (!range) {
            return;
        }
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }
        if (!nodeElement.parentElement.classList.contains("li") || nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
            return;
        }
        if (type === "outdent") {
            listOutdent(protyle, [nodeElement.parentElement], range);
        } else if (type === "indent") {
            listIndent(protyle, [nodeElement.parentElement], range);
        }
    });
};
