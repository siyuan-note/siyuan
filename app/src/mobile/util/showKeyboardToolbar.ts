import {listIndent, listOutdent} from "../../protyle/wysiwyg/list";
import {hasClosestBlock, hasClosestByMatchTag} from "../../protyle/util/hasClosest";
import {insertEmptyBlock} from "../../block/util";
import {moveToDown, moveToUp} from "../../protyle/wysiwyg/move";
import {Constants} from "../../constants";
import {focusByRange, getSelectionPosition} from "../../protyle/util/selection";

export const showKeyboardToolbar = (bottom = 0) => {
    if (getSelection().rangeCount > 0) {
        const range = getSelection().getRangeAt(0);
        if (!window.siyuan.mobile.editor ||
            !window.siyuan.mobile.editor.protyle.wysiwyg.element.contains(range.startContainer)) {
            return;
        }
    } else {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    if (!toolbarElement.classList.contains("fn__none")) {
        return;
    }
    toolbarElement.classList.remove("fn__none");
    toolbarElement.style.bottom = bottom + "px";

    setTimeout(() => {
        const contentElement = window.siyuan.mobile.editor.protyle.contentElement;
        const cursorTop = getSelectionPosition(contentElement).top - contentElement.getBoundingClientRect().top;
        if (cursorTop < window.innerHeight - 96) {
            return;
        }
        contentElement.scroll({
            top: contentElement.scrollTop + cursorTop - ((window.outerHeight - 65) / 2 - 30),
            left: contentElement.scrollLeft,
            behavior: "smooth"
        });
    }, Constants.TIMEOUT_TRANSITION);
};

export const hideKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.add("fn__none");
};

export const hideKeyboard = () => {
    (document.activeElement as HTMLElement).blur();
};

export const initKeyboardToolbar = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const buttonElement = hasClosestByMatchTag(target, "BUTTON");
        if (!buttonElement || !window.siyuan.mobile.editor) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const type = buttonElement.getAttribute("data-type");
        if (type === "done") {
            hideKeyboard();
            return;
        }
        if (window.siyuan.mobile.editor.protyle.disabled) {
            return;
        }
        const protyle = window.siyuan.mobile.editor.protyle;
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
        if (!range || (range && !protyle.wysiwyg.element.contains(range.startContainer))) {
            return;
        }
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }

        if (type === "up") {
            moveToUp(protyle, nodeElement, range);
            focusByRange(range);
            return;
        }
        if (type === "down") {
            moveToDown(protyle, nodeElement, range);
            focusByRange(range);
            return;
        }

        if (type === "before") {
            insertEmptyBlock(protyle, "beforebegin");
            return;
        }
        if (type === "after") {
            insertEmptyBlock(protyle, "afterend");
            return;
        }

        if (type === "clear") {
            if (range.toString()) {
                protyle.toolbar.setInlineMark(protyle, "clear", "toolbar");
            } else if (range.startContainer.nodeType === 3 && range.startContainer.parentElement.tagName === "SPAN") {
                range.setStartAfter(range.startContainer.parentElement);
                range.collapse(false);
                range.insertNode(document.createTextNode(Constants.ZWSP));
                range.collapse(false);
            }
            focusByRange(range);
            return;
        }

        if (!nodeElement.parentElement.classList.contains("li") || nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
            focusByRange(range);
            return;
        }
        if (type === "outdent") {
            listOutdent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
        } else if (type === "indent") {
            listIndent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
        }
    });
};
