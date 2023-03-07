import {listIndent, listOutdent} from "../../protyle/wysiwyg/list";
import {hasClosestBlock, hasClosestByClassName, hasClosestByMatchTag} from "../../protyle/util/hasClosest";
import {moveToDown, moveToUp} from "../../protyle/wysiwyg/move";
import {Constants} from "../../constants";
import {focusByRange, getSelectionPosition} from "../../protyle/util/selection";
import {removeBlock} from "../../protyle/wysiwyg/remove";
import {hintSlash} from "../../protyle/hint/extend";

let renderKeyboardToolbarTimeout: number;
let showKeyboardToolbarUtil = false;

const renderSlashMenu = (protyle: IProtyle, toolbarElement: Element) => {
    protyle.hint.splitChar = "/";
    protyle.hint.lastIndex = -1;
    const utilElement = toolbarElement.querySelector(".keyboard__util") as HTMLElement;
    utilElement.innerHTML = protyle.hint.getHTMLByData(hintSlash("", protyle), false);
    protyle.hint.bindUploadEvent(protyle, utilElement);
};

const renderKeyboardToolbarUtil = () => {
    const toolbarElement = document.getElementById("keyboardToolbar");
    const keyboardHeight = (parseInt(toolbarElement.getAttribute("data-keyboardheight")) + 42) + "px";
    toolbarElement.style.height = keyboardHeight;
    window.siyuan.mobile.editor.protyle.element.style.marginBottom = keyboardHeight;
    window.siyuan.menus.menu.remove();
    showKeyboardToolbarUtil = true;
    setTimeout(() => {
        showKeyboardToolbarUtil = false;
    }, 1000);
};

const renderKeyboardToolbar = () => {
    clearTimeout(renderKeyboardToolbarTimeout);
    renderKeyboardToolbarTimeout = window.setTimeout(() => {
        if (getSelection().rangeCount === 0 || window.siyuan.config.editor.readOnly || window.siyuan.config.readonly) {
            return;
        }
        hideKeyboardToolbarUtil();
        if (window.innerHeight + 200 > ((window.orientation === 90 || window.orientation === -90) ? screen.width : screen.height)) {
            hideKeyboardToolbar();
            return;
        }

        const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
        const range = getSelection().getRangeAt(0);
        const selectText = range.toString();
        const isProtyle = hasClosestByClassName(range.startContainer, "protyle-wysiwyg", true);
        const protyle = window.siyuan.mobile.editor.protyle;
        if (selectText || !isProtyle) {
            dynamicElements[0].classList.add("fn__none");
        } else {
            dynamicElements[0].classList.remove("fn__none");
            if (protyle.undo.undoStack.length === 0) {
                dynamicElements[0].querySelector('[data-type="undo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="undo"]').removeAttribute("disabled");
            }
            if (protyle.undo.redoStack.length === 0) {
                dynamicElements[0].querySelector('[data-type="redo"]').setAttribute("disabled", "disabled");
            } else {
                dynamicElements[0].querySelector('[data-type="redo"]').removeAttribute("disabled");
            }
            const nodeElement = hasClosestBlock(range.startContainer);
            if (nodeElement) {
                const indentElement = dynamicElements[0].querySelector('[data-type="indent"]');
                if (nodeElement.parentElement.classList.contains("li")) {
                    indentElement.classList.remove("fn__none");
                    indentElement.nextElementSibling.classList.remove("fn__none");
                    indentElement.nextElementSibling.nextElementSibling.classList.remove("fn__none");
                } else {
                    indentElement.classList.add("fn__none");
                    indentElement.nextElementSibling.classList.add("fn__none");
                    indentElement.nextElementSibling.nextElementSibling.classList.add("fn__none");
                }
            }
        }
        if (selectText && isProtyle) {
            dynamicElements[1].querySelectorAll(".protyle-toolbar__item--current").forEach(item => {
                item.classList.remove("protyle-toolbar__item--current");
            });
            const types = protyle.toolbar.getCurrentType(range);
            types.forEach(item => {
                if (["search-mark", "a", "block-ref", "virtual-block-ref", "text", "file-annotation-ref", "inline-math",
                    "inline-memo", "", "backslash"].includes(item)) {
                    return;
                }
                const itemElement = dynamicElements[1].querySelector(`[data-type="${item}"]`);
                if (itemElement) {
                    itemElement.classList.add("protyle-toolbar__item--current");
                }
            });
            dynamicElements[1].classList.remove("fn__none");
        } else {
            dynamicElements[1].classList.add("fn__none");
        }
    }, 620); // 需等待 range 更新
};

const hideKeyboardToolbarUtil = () => {
    document.getElementById("keyboardToolbar").style.height = "";
    window.siyuan.mobile.editor.protyle.element.style.marginBottom = "";
};

export const showKeyboardToolbar = (height: number) => {
    if (getSelection().rangeCount === 0 || window.siyuan.config.editor.readOnly || window.siyuan.config.readonly) {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.setAttribute("data-keyboardheight", height.toString());
    hideKeyboardToolbarUtil();
    if (!toolbarElement.classList.contains("fn__none")) {
        return;
    }
    toolbarElement.classList.remove("fn__none");
    const range = getSelection().getRangeAt(0);
    if (!window.siyuan.mobile.editor ||
        !window.siyuan.mobile.editor.protyle.wysiwyg.element.contains(range.startContainer)) {
        return;
    }
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
    if (showKeyboardToolbarUtil) {
        return;
    }
    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.classList.add("fn__none");
};

export const activeBlur = () => {
    (document.activeElement as HTMLElement).blur();
};

export const initKeyboardToolbar = () => {
    document.addEventListener("selectionchange", () => {
        renderKeyboardToolbar();
    }, false);

    const toolbarElement = document.getElementById("keyboardToolbar");
    toolbarElement.innerHTML = `<div class="fn__flex keyboard__bar">
    <div class="fn__flex-1">
        <div class="fn__none keyboard__dynamic">
            <button class="keyboard__action" data-type="indent"><svg><use xlink:href="#iconIndent"></use></svg></button>
            <button class="keyboard__action" data-type="outdent"><svg><use xlink:href="#iconOutdent"></use></svg></button>
            <span class="keyboard__split"></span>
            <button class="keyboard__action" data-type="add"><svg><use xlink:href="#iconAdd"></use></svg></button>
            <button class="keyboard__action" data-type="goinline"><svg class="keyboard__svg--big"><use xlink:href="#iconBIU"></use></svg></button>
            <button class="keyboard__action" data-type="remove"><svg><use xlink:href="#iconTrashcan"></use></svg></button>
            <span class="keyboard__split"></span>
            <button class="keyboard__action" data-type="undo"><svg><use xlink:href="#iconUndo"></use></svg></button>
            <button class="keyboard__action" data-type="redo"><svg><use xlink:href="#iconRedo"></use></svg></button>
            <button class="keyboard__action" data-type="block"><svg><use xlink:href="#iconParagraph"></use></svg></button>
            <button class="keyboard__action" data-type="more"><svg><use xlink:href="#iconMore"></use></svg></button>
            <span class="keyboard__split"></span>
            <button class="keyboard__action" data-type="moveup"><svg><use xlink:href="#iconUp"></use></svg></button>
            <button class="keyboard__action" data-type="movedown"><svg><use xlink:href="#iconDown"></use></svg></button>
        </div>
        <div class="fn__none keyboard__dynamic">
            <button class="keyboard__action" data-type="goback"><svg><use xlink:href="#iconBack"></use></svg></button>
            <button class="keyboard__action" data-type="block-ref"><svg><use xlink:href="#iconRef"></use></svg></button>
            <button class="keyboard__action" data-type="a"><svg><use xlink:href="#iconLink"></use></svg></button>
            <button class="keyboard__action" data-type="text"><svg><use xlink:href="#iconFont"></use></svg></button>
            <button class="keyboard__action" data-type="strong"><svg><use xlink:href="#iconBold"></use></svg></button>
            <button class="keyboard__action" data-type="em"><svg><use xlink:href="#iconItalic"></use></svg></button>
            <button class="keyboard__action" data-type="u"><svg><use xlink:href="#iconUnderline"></use></svg></button>
            <button class="keyboard__action" data-type="s"><svg><use xlink:href="#iconStrike"></use></svg></button>
            <button class="keyboard__action" data-type="mark"><svg><use xlink:href="#iconMark"></use></svg></button>
            <button class="keyboard__action" data-type="sup"><svg><use xlink:href="#iconSup"></use></svg></button>
            <button class="keyboard__action" data-type="sub"><svg><use xlink:href="#iconSub"></use></svg></button>
            <button class="keyboard__action" data-type="clear"><svg><use xlink:href="#iconClear"></use></svg></button>
            <button class="keyboard__action" data-type="code"><svg><use xlink:href="#iconInlineCode"></use></svg></button>
            <button class="keyboard__action" data-type="kbd"<use xlink:href="#iconKeymap"></use></svg></button>
            <button class="keyboard__action" data-type="tag"><svg><use xlink:href="#iconTags"></use></svg></button>
            <button class="keyboard__action" data-type="inline-math"><svg><use xlink:href="#iconMath"></use></svg></button>
            <button class="keyboard__action" data-type="inline-memo"><svg><use xlink:href="#iconM"></use></svg></button>
            <button class="keyboard__action" data-type="goback"><svg class="keyboard__svg--close"><use xlink:href="#iconClose"></use></svg></button>
        </div>
    </div>
    <span class="keyboard__split"></span>
    <button class="keyboard__action" data-type="done"><svg style="width: 36px"><use xlink:href="#iconKeyboardHide"></use></svg></button>
</div>
<div class="keyboard__util"></div>`;
    toolbarElement.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const slashBtnElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
        const protyle = window.siyuan.mobile.editor.protyle;
        if (slashBtnElement) {
            protyle.hint.fill(decodeURIComponent(slashBtnElement.getAttribute("data-value")), protyle);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const buttonElement = hasClosestByMatchTag(target, "BUTTON");
        if (!buttonElement || buttonElement.getAttribute("disabled")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const type = buttonElement.getAttribute("data-type");
        if (type === "done") {
            activeBlur();
            hideKeyboardToolbar();
            return;
        }
        if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly || !window.siyuan.mobile.editor) {
            return;
        }
        if (type === "undo") {
            protyle.undo.undo(protyle);
            return;
        } else if (type === "redo") {
            protyle.undo.redo(protyle);
            return;
        }
        if (getSelection().rangeCount === 0) {
            return;
        }
        const range = getSelection().getRangeAt(0);
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }
        // inline element
        if (type === "goback") {
            const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
            dynamicElements[0].classList.remove("fn__none");
            dynamicElements[1].classList.add("fn__none");
            range.collapse(true);
            focusByRange(range);
            return;
        } else if (type === "goinline") {
            const dynamicElements = document.querySelectorAll("#keyboardToolbar .keyboard__dynamic");
            dynamicElements[1].classList.remove("fn__none");
            dynamicElements[0].classList.add("fn__none");
            focusByRange(range);
            return;
        } else if (["a", "block-ref", "inline-math", "inline-memo", "text"].includes(type)) {
            protyle.toolbar.element.querySelector(`[data-type="${type}"]`).dispatchEvent(new CustomEvent("click"));
            return;
        } else if (["strong", "em", "s", "code", "mark", "tag", "u", "sup", "clear", "sub", "kbd"].includes(type)) {
            protyle.toolbar.setInlineMark(protyle, type, "toolbar");
            return;
        } else if (type === "moveup") {
            moveToUp(protyle, nodeElement, range);
            focusByRange(range);
            return;
        } else if (type === "movedown") {
            moveToDown(protyle, nodeElement, range);
            focusByRange(range);
            return;
        } else if (type === "remove") {
            nodeElement.classList.add("protyle-wysiwyg--select");
            removeBlock(protyle, nodeElement, range);
            return;
        } else if (type === "add") {
            renderSlashMenu(protyle, toolbarElement);
            renderKeyboardToolbarUtil();
            return;
        } else if (type === "more") {
            protyle.breadcrumb.showMenu(protyle, {
                x: 0,
                y: 0
            });
            activeBlur();
            return;
        } else if (type === "block") {
            protyle.gutter.renderMenu(protyle, nodeElement);
            window.siyuan.menus.menu.fullscreen();
            activeBlur();
            return;
        } else if (type === "outdent") {
            listOutdent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
            return;
        } else if (type === "indent") {
            listIndent(protyle, [nodeElement.parentElement], range);
            focusByRange(range);
        }
    });
};
