import {hideElements} from "../ui/hideElements";
import {isMac, isNotCtrl, isOnlyMeta, writeText} from "../util/compatibility";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset,
    getSelectionPosition,
    selectAll,
    setFirstNodeRange,
    setInsertWbrHTML,
    setLastNodeRange,
} from "../util/selection";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByAttribute,
    isInEmbedBlock
} from "../util/hasClosest";
import {removeBlock, removeImage} from "./remove";
import {
    getContenteditableElement,
    getFirstBlock,
    getLastBlock,
    getNextBlock,
    getParentBlock,
    getPreviousBlock,
    getTopAloneElement,
    hasNextSibling,
    hasPreviousSibling,
    isEndOfBlock,
    isNotEditBlock,
} from "./getBlock";
import {isIncludesHotKey, matchHotKey} from "../util/hotKey";
import {enter, softEnter} from "./enter";
import {clearTableCell, fixTable} from "../util/table";
import {
    transaction,
    turnsIntoOneTransaction,
    turnsIntoTransaction,
    turnsOneInto,
    updateBatchTransaction,
    updateTransaction
} from "./transaction";
import {fontEvent} from "../toolbar/Font";
import {addSubList, listIndent, listOutdent} from "./list";
import {newFileContentBySelect, rename, replaceFileName} from "../../editor/rename";
import {cancelSB, insertEmptyBlock, jumpToParent} from "../../block/util";
import {isLocalPath} from "../../util/pathName";
/// #if !MOBILE
import {openBy, openFileById} from "../../editor/util";
/// #endif
import {alignImgCenter, alignImgLeft, commonHotkey, downSelect, getStartEndElement, upSelect} from "./commonHotkey";
import {fileAnnotationRefMenu, inlineMathMenu, linkMenu, refMenu, setFold, tagMenu} from "../../menus/protyle";
import {openAttr} from "../../menus/commonMenuItem";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {scrollCenter} from "../../util/highlightById";
import {BlockPanel} from "../../block/Panel";
import * as dayjs from "dayjs";
import {highlightRender} from "../render/highlightRender";
import {countBlockWord} from "../../layout/status";
import {moveToDown, moveToUp} from "./move";
import {pasteAsPlainText} from "../util/paste";
import {preventScroll} from "../scroll/preventScroll";
import {getSavePath, newFileBySelect} from "../../util/newFile";
import {removeSearchMark} from "../toolbar/util";
import {avKeydown} from "../render/av/keydown";
import {checkFold} from "../../util/noRelyPCFunction";
import {AIActions} from "../../ai/actions";
import {openLink} from "../../editor/openLink";
import {onlyProtyleCommand} from "../../boot/globalEvent/command/protyle";
import {AIChat} from "../../ai/chat";
import {updateCalloutType} from "./callout";

export const getContentByInlineHTML = (range: Range, cb: (content: string) => void) => {
    let html = "";
    Array.from(range.cloneContents().childNodes).forEach((item: HTMLElement) => {
        if (item.nodeType === 3) {
            html += item.textContent;
        } else {
            html += item.outerHTML;
        }
    });
    fetchPost("/api/block/getDOMText", {dom: html}, (response) => {
        cb(response.data);
    });
};

export const keydown = (protyle: IProtyle, editorElement: HTMLElement) => {
    editorElement.addEventListener("keydown", async (event: KeyboardEvent & { target: HTMLElement }) => {
        if (event.target.localName === "protyle-html" || event.target.localName === "input") {
            event.stopPropagation();
            return;
        }
        if (protyle.disabled || !protyle.selectElement.classList.contains("fn__none")) {
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        protyle.wysiwyg.preventKeyup = false;
        hideElements(["util"], protyle);
        if (event.shiftKey && event.key.indexOf("Arrow") > -1) {
            // 防止连续选中的时候抖动 https://github.com/siyuan-note/insider/issues/657#issuecomment-851391217
        } else if (!event.repeat &&
            event.code !== "") { // 悬浮工具会触发但 code 为空 https://github.com/siyuan-note/siyuan/issues/6573
            hideElements(["toolbar"], protyle);
        }
        const range = getEditorRange(protyle.wysiwyg.element);
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }

        // https://ld246.com/article/1694506408293
        const endElement = hasClosestBlock(range.endContainer);
        if (!matchHotKey("⌘C", event) && endElement && nodeElement !== endElement) {
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (document.querySelector(".av__panel")) {
            return;
        }
        if (avKeydown(event, nodeElement, protyle)) {
            return;
        }

        if (nodeElement.classList.contains("protyle-wysiwyg--select") && isNotCtrl(event) && !event.shiftKey && !event.altKey) {
            if (event.key.toLowerCase() === "a") {
                event.stopPropagation();
                event.preventDefault();
                protyle.wysiwyg.element.blur();
                // 阻止中文输入的残留
                setTimeout(() => {
                    insertEmptyBlock(protyle, "afterend");
                }, 100);
                return false;
            } else if (event.key.toLowerCase() === "b") {
                event.stopPropagation();
                event.preventDefault();
                protyle.wysiwyg.element.blur();
                setTimeout(() => {
                    insertEmptyBlock(protyle, "beforebegin");
                }, 100);
                return false;
            }
        }
        if (event.isComposing) {
            event.stopPropagation();
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/2261
        if (!["⌘", "⇧", "⌥", "⌃"].includes(Constants.KEYCODELIST[event.keyCode])) {
            if (Constants.KEYCODELIST[event.keyCode] === "/" ||
                // 德语
                event.key === "/" ||
                // windows 中文
                (event.code === "Slash" && event.key === "Process" && event.keyCode === 229)) {
                protyle.hint.enableSlash = true;
            } else if (Constants.KEYCODELIST[event.keyCode] === "\\" ||
                // 德语
                event.key === "\\" ||
                // Mac 日文-罗马字 https://github.com/siyuan-note/siyuan/issues/13725
                (event.key === "," && event.keyCode === 229) ||
                // windows 中文
                (event.code === "Backslash" && event.key === "Process" && event.keyCode === 229)) {
                protyle.hint.enableSlash = false;
                hideElements(["hint"], protyle);
                // 此处不能返回，否则无法撤销 https://github.com/siyuan-note/siyuan/issues/2795
            }
        }
        // 有可能输入 shift+. ，因此需要使用 event.key 来进行判断
        if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" && event.key.indexOf("Arrow") === -1 &&
            event.key !== "Escape" && event.key !== "Shift" && event.key !== "Meta" && event.key !== "Alt" && event.key !== "Control" && event.key !== "CapsLock" &&
            !isNotEditBlock(nodeElement) && !/^F\d{1,2}$/.test(event.key) &&
            // 微软双拼使用 compositionstart，否则 focusByRange 导致无法输入文字
            event.key !== "Process") {
            setInsertWbrHTML(nodeElement, range, protyle);
            protyle.wysiwyg.preventKeyup = true;
        }

        if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
            (["←", "↑", "→", "↓"].includes(Constants.KEYCODELIST[event.keyCode]) || Constants.KEYCODELIST[event.keyCode] === "↩") &&
            !event.altKey && !event.shiftKey && isNotCtrl(event)) {
            event.preventDefault();
            return;
        } else if (event.key !== "Escape") {
            window.siyuan.menus.menu.remove();
        }

        if (!["Alt", "Meta", "Shift", "Control", "CapsLock", "Escape"].includes(event.key) && protyle.options.render.breadcrumb) {
            protyle.breadcrumb.hide();
        }

        if (!event.altKey && !event.shiftKey && isNotCtrl(event) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                hideElements(["select"], protyle);
                if (event.key === "ArrowDown") {
                    const currentSelectElement = selectElements[selectElements.length - 1] as HTMLElement;
                    let nextElement = getNextBlock(currentSelectElement) as HTMLElement;
                    if (nextElement) {
                        if (nextElement.getBoundingClientRect().width === 0) {
                            // https://github.com/siyuan-note/siyuan/issues/4294
                            const foldElement = hasTopClosestByAttribute(nextElement, "fold", "1");
                            if (foldElement) {
                                nextElement = getNextBlock(foldElement) as HTMLElement;
                                if (nextElement) {
                                    nextElement = getFirstBlock(nextElement) as HTMLElement;
                                } else {
                                    nextElement = currentSelectElement;
                                }
                            } else {
                                nextElement = currentSelectElement;
                            }
                        } else if (nextElement.getAttribute("fold") === "1"
                            && (nextElement.classList.contains("sb") || nextElement.classList.contains("bq"))) {
                            // https://github.com/siyuan-note/siyuan/issues/3913
                        } else {
                            nextElement = getFirstBlock(nextElement) as HTMLElement;
                        }
                    } else {
                        nextElement = currentSelectElement;
                    }

                    nextElement.classList.add("protyle-wysiwyg--select");
                    countBlockWord([nextElement.getAttribute("data-node-id")]);
                    const bottom = nextElement.getBoundingClientRect().bottom - protyle.contentElement.getBoundingClientRect().bottom;
                    if (bottom > 0) {
                        protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + bottom;
                        protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
                    }
                    focusBlock(nextElement);
                } else if (event.key === "ArrowUp") {
                    let previousElement: HTMLElement = getPreviousBlock(selectElements[0]) as HTMLElement;
                    if (previousElement) {
                        previousElement = getLastBlock(previousElement) as HTMLElement;
                        if (previousElement.getBoundingClientRect().width === 0) {
                            // https://github.com/siyuan-note/siyuan/issues/4294
                            const foldElement = hasTopClosestByAttribute(previousElement, "fold", "1");
                            if (foldElement) {
                                previousElement = getFirstBlock(foldElement) as HTMLElement;
                            } else {
                                previousElement = selectElements[0] as HTMLElement;
                            }
                        } else if (previousElement) {
                            // https://github.com/siyuan-note/siyuan/issues/3913
                            const foldElement = hasTopClosestByAttribute(previousElement, "fold", "1");
                            if (foldElement && (foldElement.classList.contains("sb") || foldElement.classList.contains("bq"))) {
                                previousElement = foldElement;
                            }
                        }
                    } else if (protyle.title && protyle.title.editElement &&
                        (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" || protyle.contentElement.scrollTop === 0)) {
                        const titleRange = setLastNodeRange(protyle.title.editElement, range, false);
                        titleRange.collapse(false);
                        focusByRange(titleRange);
                        event.stopPropagation();
                        event.preventDefault();
                    } else if (protyle.contentElement.scrollTop !== 0) {
                        protyle.contentElement.scrollTop = 0;
                        protyle.scroll.lastScrollTop = 8;
                    } else {
                        previousElement = selectElements[0] as HTMLElement;
                    }
                    if (previousElement) {
                        previousElement.classList.add("protyle-wysiwyg--select");
                        countBlockWord([previousElement.getAttribute("data-node-id")]);
                        const top = previousElement.getBoundingClientRect().top - protyle.contentElement.getBoundingClientRect().top;
                        if (top < 0) {
                            protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + top;
                            protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop + 1;
                        }
                        focusBlock(previousElement);
                    }
                }
                return;
            }
        }

        // 仅处理以下快捷键操作
        if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" && event.key.indexOf("Arrow") === -1 &&
            isNotCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey && !/^F\d{1,2}$/.test(event.key) &&
            event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key !== "Delete" && event.key !== "ContextMenu") {
            event.stopPropagation();
            hideElements(["select"], protyle);
            // https://github.com/siyuan-note/siyuan/issues/14743
            if (nodeElement && getContenteditableElement(nodeElement) &&
                range.endContainer.nodeType === 1 && (range.endContainer as HTMLElement).classList.contains("protyle-attr")) {
                range.collapse(true);
            }
            return false;
        }

        const nodeType = nodeElement.getAttribute("data-type");
        if (matchHotKey(window.siyuan.config.keymap.editor.general.collapse.custom, event) && !event.repeat) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                setFold(protyle, selectElements[0]);
            } else {
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeListItem") {
                    if (nodeElement.parentElement.childElementCount > 3) {
                        setFold(protyle, nodeElement.parentElement);
                    } else {
                        setFold(protyle, nodeElement);
                    }
                } else if (nodeType === "NodeHeading") {
                    setFold(protyle, nodeElement);
                } else {
                    setFold(protyle, getTopAloneElement(nodeElement));
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return false;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.expand.custom, event) && !event.repeat) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                setFold(protyle, selectElements[0], true);
            } else {
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeListItem") {
                    if (nodeElement.parentElement.childElementCount > 3) {
                        setFold(protyle, nodeElement.parentElement, true);
                    } else {
                        setFold(protyle, nodeElement, true);
                    }
                } else if (nodeType === "NodeHeading") {
                    setFold(protyle, nodeElement, true);
                } else {
                    setFold(protyle, getTopAloneElement(nodeElement), true);
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.expandUp.custom, event)) {
            upSelect({
                protyle, event, nodeElement, editorElement, range,
                cb(selectElements) {
                    const previousElement = selectElements[0].previousElementSibling as HTMLElement;
                    if (previousElement && previousElement.getAttribute("data-node-id")) {
                        previousElement.classList.add("protyle-wysiwyg--select");
                        selectElements.forEach(item => {
                            item.removeAttribute("select-end");
                        });
                        previousElement.setAttribute("select-end", "true");
                        const top = previousElement.getBoundingClientRect().top - protyle.contentElement.getBoundingClientRect().top;
                        if (top < 0) {
                            protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + top;
                            protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop + 1;
                        }
                    } else if (!getParentBlock(selectElements[0]).classList.contains("protyle-wysiwyg")) {
                        hideElements(["select"], protyle);
                        getParentBlock(selectElements[0]).classList.add("protyle-wysiwyg--select");
                    }
                }
            });
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.expandDown.custom, event)) {
            downSelect({
                protyle, event, nodeElement, editorElement, range,
                cb(selectElements) {
                    const selectLastElement = selectElements[selectElements.length - 1];
                    const nextElement = selectLastElement.nextElementSibling as HTMLElement;
                    if (nextElement && nextElement.getAttribute("data-node-id")) {
                        nextElement.classList.add("protyle-wysiwyg--select");
                        selectElements.forEach(item => {
                            item.removeAttribute("select-end");
                        });
                        nextElement.setAttribute("select-end", "true");
                        const bottom = nextElement.getBoundingClientRect().bottom - protyle.contentElement.getBoundingClientRect().bottom;
                        if (bottom > 0) {
                            protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + bottom;
                            protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
                        }
                    } else if (!getParentBlock(selectLastElement).classList.contains("protyle-wysiwyg")) {
                        hideElements(["select"], protyle);
                        getParentBlock(selectLastElement).classList.add("protyle-wysiwyg--select");
                    }
                }
            });
            return;
        }

        if (matchHotKey("⇧↑", event)) {
            upSelect({
                protyle, event, nodeElement, editorElement, range,
                cb(selectElements) {
                    const startEndElement = getStartEndElement(selectElements);
                    if (startEndElement.startElement.getBoundingClientRect().top >= startEndElement.endElement.getBoundingClientRect().top) {
                        const previousElement = startEndElement.endElement.previousElementSibling as HTMLElement;
                        if (previousElement && previousElement.getAttribute("data-node-id")) {
                            previousElement.classList.add("protyle-wysiwyg--select");
                            previousElement.setAttribute("select-end", "true");
                            startEndElement.endElement.removeAttribute("select-end");
                            const top = previousElement.getBoundingClientRect().top - protyle.contentElement.getBoundingClientRect().top;
                            if (top < 0) {
                                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + top;
                                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop + 1;
                            }
                        } else if (!getParentBlock(startEndElement.endElement).classList.contains("protyle-wysiwyg")) {
                            hideElements(["select"], protyle);
                            getParentBlock(startEndElement.endElement).classList.add("protyle-wysiwyg--select");
                        }
                    } else {
                        startEndElement.endElement.classList.remove("protyle-wysiwyg--select");
                        startEndElement.endElement.removeAttribute("select-end");
                        const previousElement = getPreviousBlock(startEndElement.endElement);
                        if (previousElement) {
                            previousElement.setAttribute("select-end", "true");
                            if (previousElement.getBoundingClientRect().top <= protyle.contentElement.getBoundingClientRect().top) {
                                preventScroll(protyle);
                                previousElement.scrollIntoView(true);
                            }
                        }
                    }
                }
            });
            return;
        }

        if (matchHotKey("⇧↓", event)) {
            downSelect({
                protyle,
                event,
                nodeElement,
                editorElement,
                range,
                cb(selectElements) {
                    const startEndElement = getStartEndElement(selectElements);
                    if (startEndElement.startElement.getBoundingClientRect().top <= startEndElement.endElement.getBoundingClientRect().top) {
                        const nextElement = startEndElement.endElement.nextElementSibling as HTMLElement;
                        if (nextElement && nextElement.getAttribute("data-node-id")) {
                            if (nextElement.getBoundingClientRect().width === 0) {
                                // https://github.com/siyuan-note/siyuan/issues/11194
                                hideElements(["select"], protyle);
                                getParentBlock(startEndElement.endElement).classList.add("protyle-wysiwyg--select");
                            } else {
                                nextElement.classList.add("protyle-wysiwyg--select");
                                nextElement.setAttribute("select-end", "true");
                                startEndElement.endElement.removeAttribute("select-end");
                                const bottom = nextElement.getBoundingClientRect().bottom - protyle.contentElement.getBoundingClientRect().bottom;
                                if (bottom > 0) {
                                    protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + bottom;
                                    protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
                                }
                            }
                        } else if (!getParentBlock(startEndElement.endElement).classList.contains("protyle-wysiwyg")) {
                            hideElements(["select"], protyle);
                            getParentBlock(startEndElement.endElement).classList.add("protyle-wysiwyg--select");
                        }
                    } else {
                        startEndElement.endElement.classList.remove("protyle-wysiwyg--select");
                        startEndElement.endElement.removeAttribute("select-end");
                        const nextElement = getNextBlock(startEndElement.endElement);
                        if (nextElement) {
                            nextElement.setAttribute("select-end", "true");
                            if (nextElement.getBoundingClientRect().bottom >= protyle.contentElement.getBoundingClientRect().bottom) {
                                preventScroll(protyle);
                                nextElement.scrollIntoView(false);
                            }
                        }
                    }
                }
            });
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.enter.custom, event)) {
            onlyProtyleCommand({
                protyle,
                command: "enter",
                previousRange: range,
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.enterBack.custom, event)) {
            onlyProtyleCommand({
                protyle,
                command: "enterBack",
                previousRange: range,
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if ((event.shiftKey && !event.altKey && isNotCtrl(event) && (event.key === "Home" || event.key === "End") && isMac()) ||
            (event.shiftKey && !event.altKey && isOnlyMeta(event) && (event.key === "Home" || event.key === "End") && !isMac())) {
            const topElement = hasTopClosestByAttribute(nodeElement, "data-node-id", null);
            if (topElement) {
                // 超级块内已选中某个块
                topElement.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select");
                });
                topElement.classList.add("protyle-wysiwyg--select");
                let nextElement = event.key === "Home" ? topElement.previousElementSibling : topElement.nextElementSibling;
                while (nextElement) {
                    nextElement.classList.add("protyle-wysiwyg--select");
                    nextElement = event.key === "Home" ? nextElement.previousElementSibling : nextElement.nextElementSibling;
                }
                if (event.key === "Home") {
                    protyle.wysiwyg.element.firstElementChild.scrollIntoView();
                } else {
                    protyle.wysiwyg.element.lastElementChild.scrollIntoView(false);
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/11726
        if ((event.key === "Home" || event.key === "End") && !event.shiftKey && !event.altKey && isNotCtrl(event)) {
            hideElements(["hint"], protyle);
        }
        // 向上/下滚动一屏
        if (!event.altKey && !event.shiftKey && isNotCtrl(event) && (event.key === "PageUp" || event.key === "PageDown")) {
            if (event.key === "PageUp") {
                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop - protyle.contentElement.clientHeight + 60;
                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop + 1;
            } else {
                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + protyle.contentElement.clientHeight - 60;
                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
            }
            const contentRect = protyle.contentElement.getBoundingClientRect();
            let centerElement = document.elementFromPoint(contentRect.x + contentRect.width / 2, contentRect.y + contentRect.height / 2);
            if (centerElement.classList.contains("protyle-wysiwyg")) {
                centerElement = document.elementFromPoint(contentRect.x + contentRect.width / 2, contentRect.y + contentRect.height / 2 + Constants.SIZE_TOOLBAR_HEIGHT);
            }
            const centerBlockElement = hasClosestBlock(centerElement);
            if (centerBlockElement && centerBlockElement !== nodeElement) {
                focusBlock(centerBlockElement, undefined, false);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // hint: 上下、回车选择
        if (!event.altKey && !event.shiftKey &&
            ((event.key.indexOf("Arrow") > -1 && isNotCtrl(event)) || event.key === "Enter") &&
            !protyle.hint.element.classList.contains("fn__none") && protyle.hint.select(event, protyle)) {
            return;
        }
        if (matchHotKey("⌘/", event)) {
            event.stopPropagation();
            event.preventDefault();
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                const inlineElement = hasClosestByAttribute(range.startContainer, "data-type", null);
                if (inlineElement && inlineElement.tagName === "SPAN") {
                    const types = inlineElement.getAttribute("data-type").split(" ");
                    if (types.length > 0) {
                        protyle.toolbar.range = range;
                        removeSearchMark(inlineElement);
                    }
                    if (types.includes("block-ref")) {
                        refMenu(protyle, inlineElement);
                        return;
                    } else if (types.includes("inline-memo")) {
                        protyle.toolbar.showRender(protyle, inlineElement);
                        return;
                    } else if (types.includes("file-annotation-ref")) {
                        fileAnnotationRefMenu(protyle, inlineElement);
                        return;
                    } else if (types.includes("a")) {
                        linkMenu(protyle, inlineElement);
                        return;
                    } else if (types.includes("tag")) {
                        tagMenu(protyle, inlineElement);
                        return;
                    }
                }

                // https://github.com/siyuan-note/siyuan/issues/5185
                if (range.startOffset === 0 && range.startContainer.nodeType === 3) {
                    const previousSibling = hasPreviousSibling(range.startContainer) as HTMLElement;
                    if (previousSibling &&
                        previousSibling.nodeType !== 3 &&
                        previousSibling.getAttribute("data-type")?.indexOf("inline-math") > -1
                    ) {
                        inlineMathMenu(protyle, previousSibling);
                        return;
                    } else if (!previousSibling &&
                        range.startContainer.parentElement.previousSibling &&
                        range.startContainer.parentElement.previousSibling === range.startContainer.parentElement.previousElementSibling &&
                        range.startContainer.parentElement.previousElementSibling.getAttribute("data-type")?.indexOf("inline-math") > -1
                    ) {
                        inlineMathMenu(protyle, range.startContainer.parentElement.previousElementSibling);
                        return;
                    }
                }

                selectElements.push(nodeElement);
            }
            if (selectElements.length === 1) {
                protyle.gutter.renderMenu(protyle, selectElements[0]);
            } else {
                protyle.gutter.renderMultipleMenu(protyle, selectElements);
            }
            const rect = nodeElement.getBoundingClientRect();
            window.siyuan.menus.menu.popup({x: rect.left, y: rect.top, isLeft: true});
            return;
        }

        if (fixTable(protyle, event, range)) {
            event.preventDefault();
            return;
        }
        const selectText = range.toString();

        // 上下左右光标移动
        if (!event.altKey && !event.shiftKey && isNotCtrl(event) && !event.isComposing && (event.key.indexOf("Arrow") > -1)) {
            // 需使用 editabled，否则代码块会把语言字数算入
            const tdElement = hasClosestByTag(range.startContainer, "TD") || hasClosestByTag(range.startContainer, "TH");
            let tdStatus;
            if (tdElement) {
                const cells = nodeElement.querySelectorAll("td, th");
                if (cells[cells.length - 1] === tdElement) {
                    tdStatus = "last";
                }
            }
            const nodeEditableElement = (tdElement || getContenteditableElement(nodeElement) || nodeElement) as HTMLElement;
            const position = getSelectionOffset(nodeEditableElement, protyle.wysiwyg.element, range);
            if (nodeElement.classList.contains("code-block") && position.end === nodeEditableElement.innerText.length) {
                // 代码块换最后一个 /n 肉眼是无法区分是否在其后的，因此统一在之前
                position.end -= 1;

            }
            // 需使用 innerText 否则表格内 br 无法传唤为 /n
            if (event.key === "ArrowDown" && nodeEditableElement?.innerText.trimRight().substr(position.start).indexOf("\n") === -1 && (
                (tdElement && tdStatus === "last" && nodeType === "NodeTable" && !getNextBlock(nodeElement)) ||
                (nodeType === "NodeCodeBlock" && !getNextBlock(nodeElement)) ||
                (nodeElement.parentElement.getAttribute("data-type") === "NodeBlockquote" && nodeElement.nextElementSibling.classList.contains("protyle-attr") && !getNextBlock(nodeElement.parentElement)) ||
                (nodeElement.parentElement.classList.contains("callout-content") && !nodeElement.nextElementSibling && !getNextBlock(nodeElement.parentElement.parentElement))
            )) {
                // 跳出代码块和bq
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeBlockquote") {
                    insertEmptyBlock(protyle, "afterend", nodeElement.parentElement.getAttribute("data-node-id"));
                } else if (nodeElement.parentElement.classList.contains("callout-content")) {
                    insertEmptyBlock(protyle, "afterend", nodeElement.parentElement.parentElement.getAttribute("data-node-id"));
                } else {
                    insertEmptyBlock(protyle, "afterend", nodeElement.getAttribute("data-node-id"));
                }
            } else if (event.key === "ArrowUp") {
                const firstEditElement = getContenteditableElement(protyle.wysiwyg.element.firstElementChild);
                if ((
                        !getPreviousBlock(nodeElement) &&  // 列表第一个块为嵌入块，第二个块为段落块，上键应选中第一个块 https://ld246.com/article/1652667912155
                        nodeElement.contains(firstEditElement)
                    ) ||
                    (!firstEditElement && nodeElement === protyle.wysiwyg.element.firstElementChild)) {
                    // 不能用\n判断，否则文字过长折行将错误 https://github.com/siyuan-note/siyuan/issues/6156
                    if (getSelectionPosition(nodeEditableElement, range).top - nodeEditableElement.getBoundingClientRect().top < 20 || nodeElement.classList.contains("av")) {
                        if (protyle.title && protyle.title.editElement &&
                            (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
                                protyle.contentElement.scrollTop === 0)) {
                            const titleRange = setLastNodeRange(protyle.title.editElement, range, false);
                            titleRange.collapse(false);
                            focusByRange(titleRange);
                            event.stopPropagation();
                            event.preventDefault();
                        } else {
                            protyle.contentElement.scrollTop = 0;
                            protyle.scroll.lastScrollTop = 8;
                        }
                    }
                } else {
                    if (((nodeEditableElement?.innerText.substr(0, position.end).indexOf("\n") === -1 || position.start === 0) &&
                        getSelectionPosition(nodeEditableElement, range).top - nodeEditableElement.getBoundingClientRect().top < 20)) {
                        let previousElement: HTMLElement = getPreviousBlock(nodeElement) as HTMLElement;
                        if (previousElement) {
                            previousElement = getLastBlock(previousElement) as HTMLElement;
                            if (previousElement) {
                                const foldElement = hasTopClosestByAttribute(previousElement, "fold", "1") as HTMLElement;
                                // 代码块或以软换行结尾的块移动光标 ↑ 会跳过 https://github.com/siyuan-note/siyuan/issues/5498
                                // 代码块全选后 ↑ 光标不会上移 https://github.com/siyuan-note/siyuan/issues/11581
                                // 段落块不能设置，否则 ↑ 后光标位置不能保持 https://github.com/siyuan-note/siyuan/issues/12710
                                if (!foldElement && previousElement.classList.contains("code-block")) {
                                    focusBlock(previousElement, undefined, false);
                                    scrollCenter(protyle, previousElement);
                                    event.stopPropagation();
                                    event.preventDefault();
                                } else if (foldElement) {
                                    // 遇到折叠块
                                    foldElement.scrollTop = 0;
                                    focusBlock(foldElement, undefined, true);
                                    scrollCenter(protyle, foldElement);
                                    event.stopPropagation();
                                    event.preventDefault();
                                } else {
                                    // 修正光标上移至 \n 结尾的块时落点错误 https://github.com/siyuan-note/siyuan/issues/14443
                                    const prevEditableElement = getContenteditableElement(previousElement) as HTMLElement;
                                    if (prevEditableElement && prevEditableElement.lastChild?.nodeType === 3 &&
                                        prevEditableElement.lastChild?.textContent.endsWith("\n")) {
                                        //  不能移除 /n, 否则两个 /n 导致界面异常
                                        focusBlock(previousElement, undefined, false);
                                        event.preventDefault();
                                        event.stopPropagation();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (selectText === "" && (event.key === "ArrowDown" || event.key === "ArrowRight") && nodeElement === getLastBlock(protyle.wysiwyg.element.lastElementChild) &&
                // 表格无法右移动 https://ld246.com/article/1631434502215
                !hasClosestByTag(range.startContainer, "TD") && !hasClosestByTag(range.startContainer, "TH")) {
                // 页面按向下/右箭头丢失焦点 https://ld246.com/article/1629954026096
                const lastEditElement = getContenteditableElement(nodeElement);
                // 代码块需替换最后一个 /n  https://github.com/siyuan-note/siyuan/issues/3221
                if (lastEditElement && !lastEditElement.querySelector(".emoji") && lastEditElement.textContent.replace(/\n$/, "").length <= getSelectionOffset(lastEditElement, undefined, range).end) {
                    event.stopPropagation();
                    event.preventDefault();
                    focusByRange(range);
                }
            } else if (selectText === "" && event.key === "ArrowLeft" && nodeElement === getFirstBlock(protyle.wysiwyg.element.firstElementChild)) {
                // 页面向左箭头丢失焦点 https://github.com/siyuan-note/siyuan/issues/2768
                const firstEditElement = getContenteditableElement(nodeElement);
                if (firstEditElement && getSelectionOffset(firstEditElement, undefined, range).start === 0) {
                    event.stopPropagation();
                    event.preventDefault();
                    focusByRange(range);
                }
            }
            if (event.key === "ArrowDown") {
                if (nodeEditableElement?.innerText.trimRight().substr(position.start).indexOf("\n") === -1 &&
                    nodeElement === protyle.wysiwyg.element.lastElementChild && !tdElement) {
                    setLastNodeRange(getContenteditableElement(nodeEditableElement), range, false);
                    range.collapse(false);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                const foldElement = hasClosestByAttribute(range.startContainer, "fold", "1");
                if (foldElement) {
                    // 本身为折叠块
                    let nextElement = getNextBlock(foldElement) as HTMLElement;
                    if (nextElement) {
                        if (nextElement.getAttribute("fold") === "1"
                            && (nextElement.classList.contains("sb") || nextElement.classList.contains("bq"))) {
                            // https://github.com/siyuan-note/siyuan/issues/3913
                        } else {
                            nextElement = getFirstBlock(nextElement) as HTMLElement;
                        }
                        focusBlock(nextElement);
                        scrollCenter(protyle, nextElement);
                    }
                    event.stopPropagation();
                    event.preventDefault();
                } else if (nodeEditableElement?.innerText.substr(position.end).indexOf("\n") === -1 || position.end >= nodeEditableElement.innerText.trimEnd().length) {
                    // 需使用 innerText，否则 td 中的 br 无法转换为 \n; position.end 不能加1，否则倒数第二行行末无法下移
                    range.collapse(false);
                    const nextElement = getNextBlock(nodeElement) as HTMLElement;
                    if (nextElement &&
                        (nextElement.getAttribute("fold") === "1" || nextElement.classList.contains("code-block")) &&
                        nodeEditableElement.getBoundingClientRect().bottom - getSelectionPosition(nodeElement, range).top < 40) {
                        focusBlock(nextElement);
                        scrollCenter(protyle, nextElement);
                        event.stopPropagation();
                        event.preventDefault();
                    }
                }
            }
            if (selectText === "" && event.key === "ArrowLeft" && position.start === 1 &&
                range.startContainer.textContent === Constants.ZWSP) {
                range.setStart(range.startContainer, 0);
                range.collapse(true);
            }
            if (selectText === "" && event.key === "ArrowRight" && position.start === 0 &&
                range.startContainer.textContent === Constants.ZWSP) {
                range.setStart(range.startContainer, 1);
                range.collapse(true);
            }
            return;
        }

        // 删除，不可使用 isNotCtrl(event)，否则软删除回导致 https://github.com/siyuan-note/siyuan/issues/5607
        // 不可使用 !event.shiftKey，否则 https://ld246.com/article/1666434796806
        if ((!event.altKey && (event.key === "Backspace" || event.key === "Delete")) ||
            matchHotKey("⌃D", event)) {
            if (protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
                removeBlock(protyle, nodeElement, range, event.key === "Backspace" ? "Backspace" : "Delete");
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            // https://github.com/siyuan-note/siyuan/issues/6796
            if (selectText === "" && event.key === "Backspace" &&
                range.startOffset === range.startContainer.textContent.length &&
                range.startContainer.textContent.endsWith("\n" + Constants.ZWSP)) {
                range.setStart(range.startContainer, range.startOffset - 1);
                range.collapse(true);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const previousSibling = hasPreviousSibling(range.startContainer) as HTMLElement;
            // https://github.com/siyuan-note/siyuan/issues/5547
            if (range.startOffset === 1 && range.startContainer.textContent === Constants.ZWSP &&
                previousSibling && previousSibling.nodeType !== 3 &&
                event.key === "Backspace" // https://github.com/siyuan-note/siyuan/issues/6786
            ) {
                if (previousSibling.classList.contains("img")) {
                    previousSibling.classList.add("img--select");
                } else if (previousSibling.getAttribute("data-type")?.indexOf("inline-math") > -1) {
                    // 数学公式相邻中有 zwsp,无法删除
                    previousSibling.after(document.createElement("wbr"));
                    const oldHTML = nodeElement.outerHTML;
                    range.startContainer.textContent = "";
                    previousSibling.remove();
                    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                    focusByWbr(nodeElement, range);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
            }
            const editElement = getContenteditableElement(nodeElement) as HTMLElement;
            const imgSelectElement = protyle.wysiwyg.element.querySelector(".img--select");
            if (imgSelectElement) {
                imgSelectElement.classList.remove("img--select");
                if (nodeElement.contains(imgSelectElement)) {
                    removeImage(imgSelectElement, nodeElement, range, protyle);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
            } else if (selectText === "") {
                if (nodeElement.classList.contains("table") && nodeElement.querySelector(".table__select").clientHeight > 0) {
                    clearTableCell(protyle, nodeElement);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                if (!editElement) {
                    nodeElement.classList.add("protyle-wysiwyg--select");
                    removeBlock(protyle, nodeElement, range, event.key === "Backspace" ? "Backspace" : "Delete");
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                const position = getSelectionOffset(editElement, protyle.wysiwyg.element, range);
                if (event.key === "Delete" || matchHotKey("⌃D", event)) {
                    if (range.startOffset === 0 && range.startContainer.textContent.length === 1) {
                        // 图片后为空格，在空格后删除 https://github.com/siyuan-note/siyuan/issues/13949
                        const rangePreviousElement = hasPreviousSibling(range.startContainer) as HTMLElement;
                        const rangeNextElement = hasNextSibling(range.startContainer) as HTMLElement;
                        if (rangePreviousElement && rangePreviousElement.nodeType === 1 && rangePreviousElement.classList.contains("img") &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img")) {
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            const oldHTML = nodeElement.outerHTML;
                            wbrElement.nextSibling.textContent = Constants.ZWSP;
                            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, range);
                            event.preventDefault();
                            return;
                        }
                        // 图片前有一个字符，在字符后删除 https://github.com/siyuan-note/siyuan/issues/15911
                        if (position.start === 0 &&
                            range.startContainer.textContent !== Constants.ZWSP &&  // 如果为 zwsp 需前移光标
                            !rangePreviousElement &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img")) {
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            const oldHTML = nodeElement.outerHTML;
                            wbrElement.nextSibling.textContent = Constants.ZWSP;
                            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, range);
                            event.preventDefault();
                            return;
                        }
                    }
                    // 需使用 innerText，否则 br 无法传唤为 /n https://github.com/siyuan-note/siyuan/issues/12066
                    // 段末反向删除 https://github.com/siyuan-note/insider/issues/274
                    if (isEndOfBlock(range) || editElement.textContent.substring(position.start) === "\n") {
                        const cloneRange = range.cloneRange();
                        const nextElement = getNextBlock(getTopAloneElement(nodeElement));
                        if (nextElement) {
                            const nextRange = focusBlock(nextElement);
                            if (nextRange) {
                                const nextBlockElement = hasClosestBlock(nextRange.startContainer);
                                if (nextBlockElement &&
                                    (!nextBlockElement.classList.contains("code-block") ||
                                        (nextBlockElement.classList.contains("code-block") &&
                                            (getContenteditableElement(nextBlockElement).textContent == "\n") || nextBlockElement.parentElement.classList.contains("li")))
                                ) {
                                    // 反向删除合并为一个块时，光标应保持在尾部 https://github.com/siyuan-note/siyuan/issues/14290#issuecomment-2849810529
                                    cloneRange.insertNode(document.createElement("wbr"));
                                    removeBlock(protyle, nextBlockElement, nextRange, "Delete");
                                }
                            }
                            event.stopPropagation();
                            event.preventDefault();
                            return;
                        }
                    } else if (position.end === editElement.innerText.length - 1 && nodeType === "NodeCodeBlock") {
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    } else {
                        // 图片前 Delete 无效 https://github.com/siyuan-note/siyuan/issues/11209
                        let nextSibling = hasNextSibling(range.startContainer) as Element;
                        if (nextSibling) {
                            if (nextSibling.nodeType === 3 && nextSibling.textContent === Constants.ZWSP) {
                                if (!nextSibling.nextSibling) {
                                    // https://github.com/siyuan-note/siyuan/issues/13524
                                    const nextBlockElement = getNextBlock(nodeElement);
                                    if (nextBlockElement) {
                                        removeBlock(protyle, nextBlockElement, range, "remove");
                                    }
                                    event.stopPropagation();
                                    event.preventDefault();
                                    return;
                                }
                                nextSibling = nextSibling.nextSibling as Element;
                            }

                            if (nextSibling.nodeType === 1 && nextSibling.classList.contains("img")) {
                                // 光标需在图片前 https://github.com/siyuan-note/siyuan/issues/12452
                                const textPosition = getSelectionOffset(range.startContainer, protyle.wysiwyg.element, range);
                                if (textPosition.start === range.startContainer.textContent.length ||
                                    (textPosition.start === 0 && range.startContainer.textContent === Constants.ZWSP)) {
                                    removeImage(nextSibling as Element, nodeElement, range, protyle);
                                    event.stopPropagation();
                                    event.preventDefault();
                                    return;
                                }
                            }
                        }
                    }
                } else {
                    const currentNode = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement;
                    if (position.start === 0 && (
                        range.startOffset === 0 ||
                        (currentNode && currentNode.nodeType === 3 && !hasPreviousSibling(currentNode) &&
                            // 需使用 textContent，文本元素没有 innerText
                            currentNode.textContent === "") // https://ld246.com/article/1649251218696
                    )) {
                        if (!nodeElement.classList.contains("code-block") ||
                            (nodeElement.classList.contains("code-block") &&
                                (editElement.textContent == "\n" || nodeElement.parentElement.classList.contains("li")))
                        ) {
                            removeBlock(protyle, nodeElement, range, "Backspace");
                        }
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    if (range.startContainer.nodeType !== 3 &&
                        nodeType === "NodeTable" &&
                        (range.startContainer as HTMLElement).children[range.startOffset - 1]?.tagName === "TABLE") {
                        nodeElement.classList.add("protyle-wysiwyg--select");
                        removeBlock(protyle, nodeElement, range, "Backspace");
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    // 图片后为 br，在 br 后删除 https://github.com/siyuan-note/siyuan/issues/4963
                    if (currentNode && currentNode.nodeType !== 3 && currentNode.classList.contains("img")) {
                        removeImage(currentNode, nodeElement, range, protyle);
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    const rangeNextElement = hasNextSibling(range.startContainer) as HTMLElement;
                    // \n1`2` 1后按 Backspace 光标错误 https://github.com/siyuan-note/siyuan/issues/15424
                    if (rangeNextElement && rangeNextElement.nodeType === 1 &&
                        ["code", "tag", "kbd"].includes(rangeNextElement.dataset.type)) {
                        if (position.start === 1 || range.startContainer.textContent.slice(-2, -1) === "\n") {
                            range.insertNode(document.createTextNode(Constants.ZWSP));
                            range.collapse(true);
                        }
                    }
                    if (range.startOffset === 1 && range.startContainer.textContent.length === 1) {
                        // 图片后为空格，在空格后删除 https://github.com/siyuan-note/siyuan/issues/13949
                        const rangePreviousElement = hasPreviousSibling(range.startContainer) as HTMLElement;
                        if (rangePreviousElement && rangePreviousElement.nodeType === 1 && rangePreviousElement.classList.contains("img") &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img")) {
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            const oldHTML = nodeElement.outerHTML;
                            wbrElement.previousSibling.textContent = Constants.ZWSP;
                            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, range);
                            event.preventDefault();
                            return;
                        }
                        // 图片前有一个字符，在字符后删除
                        if (position.start === 1 &&
                            range.startContainer.textContent !== Constants.ZWSP &&  // 如果为 zwsp 需前移光标
                            !rangePreviousElement &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img")) {
                            const wbrElement = document.createElement("wbr");
                            range.insertNode(wbrElement);
                            const oldHTML = nodeElement.outerHTML;
                            wbrElement.previousSibling.textContent = Constants.ZWSP;
                            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                            focusByWbr(nodeElement, range);
                            event.preventDefault();
                            return;
                        }
                    }
                    // 代码块中空行 ⌘+Del 异常 https://ld246.com/article/1663166544901
                    if (nodeElement.classList.contains("code-block") && isOnlyMeta(event) &&
                        range.startContainer.nodeType === 3 && range.startContainer.textContent.substring(range.startOffset - 1, range.startOffset) === "\n") {
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    // https://github.com/siyuan-note/siyuan/issues/9690
                    const inlineElement = hasClosestByTag(range.startContainer, "SPAN");
                    if (position.start === 2 && inlineElement &&
                        getSelectionOffset(inlineElement, protyle.wysiwyg.element, range).start === 1 &&
                        inlineElement.innerText.startsWith(Constants.ZWSP) &&
                        // 7.1 ctrl+g 后删除 https://github.com/siyuan-note/siyuan/issues/14290#issuecomment-2867478746
                        inlineElement.innerText !== Constants.ZWSP &&
                        // 需排除行内代码前有一个字符的情况
                        editElement.innerText.startsWith(Constants.ZWSP)) {
                        focusBlock(nodeElement);
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    if (position.start === 1 && !inlineElement && editElement.innerText.startsWith(Constants.ZWSP) &&
                        // https://github.com/siyuan-note/siyuan/issues/12149
                        editElement.innerText.length > 1) {
                        setFirstNodeRange(editElement, range);
                        removeBlock(protyle, nodeElement, range, "Backspace");
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                }
            } else if (nodeElement.classList.contains("code-block") && editElement.textContent === "\n") {
                // 空代码块全选删除异常 https://github.com/siyuan-note/siyuan/issues/6706
                range.collapse(true);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (selectText !== "") {
                const position = getSelectionOffset(editElement, protyle.wysiwyg.element, range);
                if (range.startOffset === 0 && range.endContainer.textContent.length === range.endOffset) {
                    // 图片后为空格，在空格后删除 https://github.com/siyuan-note/siyuan/issues/13949
                    // 图片前有一个字符，在字符后删除 https://github.com/siyuan-note/siyuan/issues/15911
                    const rangePreviousElement = hasPreviousSibling(range.startContainer) as HTMLElement;
                    const rangeNextElement = hasNextSibling(range.endContainer) as HTMLElement;
                    if ((rangePreviousElement && rangePreviousElement.nodeType === 1 && rangePreviousElement.classList.contains("img") &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img")) ||
                        (position.start === 0 &&
                            range.startContainer.textContent !== Constants.ZWSP &&  // 如果为 zwsp 需前移光标
                            !rangePreviousElement &&
                            rangeNextElement && rangeNextElement.nodeType === 1 && rangeNextElement.classList.contains("img"))) {
                        range.insertNode(document.createElement("wbr"));
                        const oldHTML = nodeElement.outerHTML;
                        range.deleteContents();
                        range.insertNode(document.createTextNode(Constants.ZWSP));
                        range.insertNode(document.createElement("wbr"));
                        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                        focusByWbr(nodeElement, range);
                        event.preventDefault();
                        return;
                    }
                }
            }
        }

        // 软换行
        if (matchHotKey("⇧↩", event) && selectText === "" && softEnter(range, nodeElement, protyle)) {
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // 代码块语言选择 https://github.com/siyuan-note/siyuan/issues/14126
        if (matchHotKey("⌥↩", event) && selectText === "") {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            if (selectElements.length > 0 && !isIncludesHotKey("⌥↩")) {
                const languageElements: HTMLElement[] = [];
                const calloutElements: HTMLElement[] = [];
                selectElements.forEach(item => {
                    if (item.classList.contains("code-block")) {
                        languageElements.push(item.querySelector(".protyle-action__language"));
                    } else {
                        const calloutElement = hasClosestByClassName(item, "callout");
                        if (calloutElement) {
                            calloutElements.push(calloutElement);
                        }
                    }
                });
                if (languageElements.length > 0) {
                    protyle.toolbar.showCodeLanguage(protyle, languageElements);
                } else if (addSubList(protyle, nodeElement, range)) {
                    // 函数内部已处理
                } else if (calloutElements.length > 0) {
                    updateCalloutType(calloutElements, protyle);
                }
                event.stopPropagation();
                event.preventDefault();
                return;
            }
        }

        // 回车
        if (matchHotKey("↩", event) ||
            (matchHotKey("⇧↩", event) && nodeType === "NodeHeading")) {
            enter(nodeElement, range, protyle);
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (matchHotKey("⌘A", event)) {
            event.preventDefault();
            selectAll(protyle, nodeElement, range);
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.undo.custom, event)) {
            protyle.undo.undo(protyle);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.redo.custom, event)) {
            protyle.undo.redo(protyle);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        /// #if !MOBILE
        if (commonHotkey(protyle, event, nodeElement)) {
            return true;
        }
        /// #endif

        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyText.custom, event)) {
            // 用于标识复制文本 *
            if (selectText !== "") {
                // 和复制块引用保持一致 https://github.com/siyuan-note/siyuan/issues/9093
                getContentByInlineHTML(range, (content) => {
                    writeText(`${content.trim()} ((${nodeElement.getAttribute("data-node-id")} "*"))`);
                });
            } else {
                const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
                if (selectElements.length > 0) {
                    selectElements[0].setAttribute("data-reftext", "true");
                    focusByRange(getEditorRange(nodeElement));
                    document.execCommand("copy");
                } else {
                    writeText(`((${nodeElement.getAttribute("data-node-id")} "*"))`);
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.attr.custom, event)) {
            const topElement = getTopAloneElement(nodeElement);
            if (selectText === "") {
                const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
                let actionElement;
                if (selectElements.length === 1) {
                    actionElement = selectElements[0];
                } else {
                    actionElement = topElement;
                }
                openAttr(actionElement, "bookmark", protyle);
            } else {
                getContentByInlineHTML(range, (content) => {
                    const oldHTML = topElement.outerHTML;
                    const nameElement = topElement.lastElementChild.querySelector(".protyle-attr--name");
                    if (nameElement) {
                        nameElement.innerHTML = `<svg><use xlink:href="#iconN"></use></svg>${content.trim()}`;
                    } else {
                        topElement.lastElementChild.insertAdjacentHTML("afterbegin", `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${content.trim()}</div>`);
                    }
                    topElement.setAttribute("name", content.trim());
                    updateTransaction(protyle, topElement.getAttribute("data-node-id"), topElement.outerHTML, oldHTML);
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.rename.custom, event) && !protyle.disabled) {
            if (selectText === "") {
                fetchPost("/api/block/getDocInfo", {
                    id: protyle.block.rootID
                }, (response) => {
                    rename({
                        notebookId: protyle.notebookId,
                        path: protyle.path,
                        name: response.data.ial.title,
                        range,
                        type: "file",
                    });
                });
            } else {
                fetchPost("/api/filetree/renameDoc", {
                    notebook: protyle.notebookId,
                    path: protyle.path,
                    title: replaceFileName(selectText),
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const isNewNameFile = matchHotKey(window.siyuan.config.keymap.editor.general.newNameFile.custom, event);
        if (isNewNameFile || matchHotKey(window.siyuan.config.keymap.editor.general.newNameSettingFile.custom, event)) {
            if (!selectText.trim() && (nodeElement.querySelector("tr") || nodeElement.querySelector("span"))) {
                // 没选中时，都是纯文本就创建子文档 https://ld246.com/article/1663073488381/comment/1664804353295#comments
            } else {
                if (!selectText.trim() &&
                    getContenteditableElement(nodeElement).textContent  // https://github.com/siyuan-note/siyuan/issues/8099
                ) {
                    selectAll(protyle, nodeElement, range);
                }
                if (isNewNameFile) {
                    fetchPost("/api/filetree/getHPathByPath", {
                        notebook: protyle.notebookId,
                        path: protyle.path,
                    }, (response) => {
                        newFileBySelect(protyle, selectText, nodeElement, response.data, protyle.notebookId);
                    });
                } else {
                    getSavePath(protyle.path, protyle.notebookId, (pathString, targetNotebookId) => {
                        newFileBySelect(protyle, selectText, nodeElement, pathString, targetNotebookId);
                    });
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.newContentFile.custom, event)) {
            newFileContentBySelect(protyle);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignLeft.custom, event)) {
            const imgSelectElements = nodeElement.querySelectorAll(".img--select");
            if (imgSelectElements.length > 0) {
                alignImgLeft(protyle, nodeElement, Array.from(imgSelectElements), nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML);
            } else {
                let selectElements: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                if (selectElements.length === 0) {
                    selectElements = [nodeElement];
                }
                updateBatchTransaction(selectElements, protyle, (e: HTMLElement) => {
                    if (e.classList.contains("av")) {
                        e.style.justifyContent = "";
                    } else {
                        e.style.textAlign = "left";
                    }
                });
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignCenter.custom, event)) {
            const imgSelectElements = nodeElement.querySelectorAll(".img--select");
            if (imgSelectElements.length > 0) {
                alignImgCenter(protyle, nodeElement, Array.from(imgSelectElements), nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML);
            } else {
                let selectElements: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                if (selectElements.length === 0) {
                    selectElements = [nodeElement];
                }
                updateBatchTransaction(selectElements, protyle, (e: HTMLElement) => {
                    if (e.classList.contains("av")) {
                        e.style.justifyContent = "center";
                    } else {
                        e.style.textAlign = "center";
                    }
                });
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignRight.custom, event)) {
            let selectElements: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements = [nodeElement];
            }
            updateBatchTransaction(selectElements, protyle, (e: HTMLElement) => {
                if (e.classList.contains("av")) {
                    e.style.justifyContent = "flex-end";
                } else {
                    e.style.textAlign = "right";
                }
            });
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.rtl.custom, event)) {
            let selectElements: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements = [nodeElement];
            }
            updateBatchTransaction(selectElements, protyle, (e: HTMLElement) => {
                e.style.direction = "rtl";
            });
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.ltr.custom, event)) {
            let selectElements: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements = [nodeElement];
            }
            updateBatchTransaction(selectElements, protyle, (e: HTMLElement) => {
                e.style.direction = "ltr";
            });
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // esc
        if (event.key === "Escape") {
            if (event.repeat) {
                // https://github.com/siyuan-note/siyuan/issues/12989
                const cardElement = hasClosestByClassName(range.startContainer, "card__main", true);
                if (cardElement && document.activeElement && document.activeElement.classList.contains("protyle-wysiwyg")) {
                    (cardElement.querySelector(".card__action:not(.fn__none) button:not([disabled])") as HTMLElement).focus();
                    hideElements(["select"], protyle);
                }
            } else {
                if (!protyle.toolbar.element.classList.contains("fn__none") ||
                    !protyle.hint.element.classList.contains("fn__none") ||
                    !protyle.toolbar.subElement.classList.contains("fn__none")) {
                    hideElements(["toolbar", "hint", "util"], protyle);
                    protyle.hint.enableExtend = false;
                } else if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                    // 防止 ESC 时选中当前块
                    window.siyuan.menus.menu.remove(true);
                } else if (nodeElement.classList.contains("protyle-wysiwyg--select")) {
                    hideElements(["select"], protyle);
                    countBlockWord([], protyle.block.rootID);
                } else {
                    hideElements(["select"], protyle);
                    range.collapse(false);
                    nodeElement.classList.add("protyle-wysiwyg--select");
                    countBlockWord([nodeElement.getAttribute("data-node-id")], protyle.block.rootID);
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // h1 - h6 hotkey
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.paragraph.custom, event)) {
            const selectsElement = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement.push(nodeElement);
            }
            if (selectsElement.length > 1) {
                turnsIntoTransaction({
                    protyle,
                    nodeElement: selectsElement[0],
                    type: "Blocks2Ps",
                });
            } else {
                const type = selectsElement[0].getAttribute("data-type");
                if (type === "NodeHeading") {
                    turnsIntoTransaction({
                        protyle,
                        nodeElement: selectsElement[0],
                        type: "Blocks2Ps",
                    });
                } else if (type === "NodeList") {
                    turnsOneInto({
                        protyle,
                        nodeElement: selectsElement[0],
                        id: selectsElement[0].getAttribute("data-node-id"),
                        type: "CancelList",
                    });
                } else if (type === "NodeBlockquote") {
                    turnsOneInto({
                        protyle,
                        nodeElement: selectsElement[0],
                        id: selectsElement[0].getAttribute("data-node-id"),
                        type: "CancelBlockquote",
                    });
                } else if (type === "NodeCallout") {
                    turnsOneInto({
                        protyle,
                        nodeElement: selectsElement[0],
                        id: selectsElement[0].getAttribute("data-node-id"),
                        type: "CancelCallout",
                    });
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading1.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 1
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading2.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 2
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading3.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 3
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading4.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 4
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading5.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 5
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading6.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Hs",
                level: 6
            });
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.code.custom, event) &&
            !["NodeCodeBlock", "NodeHeading", "NodeTable"].includes(nodeType)) {
            const editElement = getContenteditableElement(nodeElement);
            if (editElement) {
                const id = nodeElement.getAttribute("data-node-id");
                const html = nodeElement.outerHTML;
                // 需要 EscapeHTMLStr https://github.com/siyuan-note/siyuan/issues/11451
                editElement.innerHTML = "```" + window.siyuan.storage[Constants.LOCAL_CODELANG] + "\n" + Lute.EscapeHTMLStr(editElement.textContent) + "<wbr>\n```";
                const newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                nodeElement.outerHTML = newHTML;
                const newNodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                updateTransaction(protyle, id, newHTML, html);
                highlightRender(newNodeElement);
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }

        // toolbar action
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.lastUsed.custom, event)) {
            protyle.toolbar.range = range;
            const selectElements: Element[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectText === "" && selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            fontEvent(protyle, selectElements);
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (!nodeElement.classList.contains("code-block") && !event.repeat && !isInEmbedBlock(nodeElement)) {
            let findToolbar = false;
            protyle.options.toolbar.find((menuItem: IMenuItem) => {
                if (!menuItem.hotkey) {
                    return false;
                }
                if (matchHotKey(menuItem.hotkey, event)) {
                    // 设置 lastHTMLs 会导致  protyle.toolbar.range 和 range 不一致，需重置一下 https://github.com/siyuan-note/siyuan/issues/10933
                    protyle.toolbar.range = range;
                    if (["block-ref"].includes(menuItem.name) && protyle.toolbar.range.toString() === "") {
                        return true;
                    }
                    findToolbar = true;
                    if (["a", "block-ref", "inline-math", "inline-memo", "text"].includes(menuItem.name)) {
                        protyle.toolbar.element.querySelector(`[data-type="${menuItem.name}"]`).dispatchEvent(new CustomEvent("click"));
                    } else if (Constants.INLINE_TYPE.includes(menuItem.name)) {
                        protyle.toolbar.setInlineMark(protyle, menuItem.name, "range");
                    } else if (menuItem.click) {
                        menuItem.click(protyle.getInstance());
                    }
                    return true;
                }
            });
            if (findToolbar) {
                event.preventDefault();
                event.stopPropagation();
                protyle.wysiwyg.preventKeyup = true;
                return true;
            }
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.list.outdent.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                let isContinuous = true;
                selectElements.forEach((item, index) => {
                    if (item.nextElementSibling && selectElements[index + 1]) {
                        if (selectElements[index + 1] !== item.nextElementSibling) {
                            isContinuous = false;
                        }
                    }
                });
                if (isContinuous &&
                    (selectElements[0].classList.contains("li") || selectElements[0].parentElement.classList.contains("li"))) {
                    listOutdent(protyle, Array.from(selectElements), range);
                }
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeType !== "NodeCodeBlock") {
                listOutdent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.list.indent.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                let isContinuous = true;
                selectElements.forEach((item, index) => {
                    if (item.nextElementSibling && selectElements[index + 1]) {
                        if (selectElements[index + 1] !== item.nextElementSibling) {
                            isContinuous = false;
                        }
                    }
                });
                if (isContinuous &&
                    (selectElements[0].classList.contains("li") || selectElements[0].parentElement.classList.contains("li"))) {
                    listIndent(protyle, Array.from(selectElements), range);
                }
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeType !== "NodeCodeBlock") {
                listIndent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }
        const isMatchList = matchHotKey(window.siyuan.config.keymap.editor.insert.list.custom, event);
        const isMatchCheck = matchHotKey(window.siyuan.config.keymap.editor.insert.check.custom, event);
        const isMatchOList = matchHotKey(window.siyuan.config.keymap.editor.insert["ordered-list"].custom, event);
        const isMatchQuote = matchHotKey(window.siyuan.config.keymap.editor.insert.quote.custom, event);
        if (isMatchList || isMatchOList || isMatchCheck || isMatchQuote) {
            const selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement.push(nodeElement);
            }
            if (selectsElement.length === 1) {
                const subType = selectsElement[0].dataset.subtype;
                const type = selectsElement[0].dataset.type;
                if (isMatchQuote) {
                    if (["NodeHeading", "NodeParagraph", "NodeList"].includes(type)) {
                        turnsIntoOneTransaction({
                            protyle,
                            selectsElement,
                            type: "Blocks2Blockquote"
                        });
                    } else {
                        protyle.hint.splitChar = "/";
                        protyle.hint.lastIndex = -1;
                        protyle.hint.fill(">" + Lute.Caret, protyle);
                    }
                } else {
                    if (type === "NodeParagraph") {
                        turnsIntoOneTransaction({
                            protyle,
                            selectsElement,
                            type: isMatchCheck ? "Blocks2TLs" : (isMatchList ? "Blocks2ULs" : "Blocks2OLs")
                        });
                    } else if (type === "NodeList") {
                        const id = selectsElement[0].dataset.nodeId;
                        if (subType === "o" && (isMatchList || isMatchCheck)) {
                            turnsOneInto({
                                protyle,
                                nodeElement: selectsElement[0],
                                id,
                                type: isMatchCheck ? "UL2TL" : "OL2UL",
                            });
                        } else if (subType === "t" && (isMatchList || isMatchOList)) {
                            turnsOneInto({
                                protyle,
                                nodeElement: selectsElement[0],
                                id,
                                type: isMatchList ? "TL2UL" : "TL2OL",
                            });
                        } else if (subType === "u" && (isMatchCheck || isMatchOList)) {
                            turnsOneInto({
                                protyle,
                                nodeElement: selectsElement[0],
                                id,
                                type: isMatchCheck ? "OL2TL" : "UL2OL",
                            });
                        }
                    } else {
                        protyle.hint.splitChar = "/";
                        protyle.hint.lastIndex = -1;
                        protyle.hint.fill((isMatchCheck ? "- [ ] " : (isMatchList ? "- " : "1. ")) + Lute.Caret, protyle);
                    }
                }
            } else {
                let isList = false;
                let isContinue = false;
                selectsElement.find((item, index) => {
                    if (item.classList.contains("li")) {
                        isList = true;
                        return true;
                    }
                    if (item.nextElementSibling && selectsElement[index + 1] &&
                        item.nextElementSibling === selectsElement[index + 1]) {
                        isContinue = true;
                    } else if (index !== selectsElement.length - 1) {
                        isContinue = false;
                        return true;
                    }
                });
                if (!isList && isContinue) {
                    turnsIntoOneTransaction({
                        protyle,
                        selectsElement,
                        type: isMatchQuote ? "Blocks2Blockquote" : (isMatchCheck ? "Blocks2TLs" : (isMatchList ? "Blocks2ULs" : "Blocks2OLs"))
                    });
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.insert.table.custom, event)) {
            protyle.hint.splitChar = "/";
            protyle.hint.lastIndex = -1;
            protyle.hint.fill(`| ${Lute.Caret} |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`, protyle);
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.list.checkToggle.custom, event)) {
            const taskItemElement = hasClosestByAttribute(range.startContainer, "data-subtype", "t");
            if (!taskItemElement) {
                return;
            }
            const html = taskItemElement.outerHTML;
            if (taskItemElement.classList.contains("protyle-task--done")) {
                taskItemElement.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                taskItemElement.classList.remove("protyle-task--done");
            } else {
                taskItemElement.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                taskItemElement.classList.add("protyle-task--done");
            }
            taskItemElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, taskItemElement.getAttribute("data-node-id"), taskItemElement.outerHTML, html);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertBefore.custom, event)) {
            // https://github.com/siyuan-note/siyuan/issues/14290#issuecomment-2846594701
            nodeElement.querySelector(".img--select")?.classList.remove("img--select");
            insertEmptyBlock(protyle, "beforebegin");
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertAfter.custom, event)) {
            nodeElement.querySelector(".img--select")?.classList.remove("img--select");
            insertEmptyBlock(protyle, "afterend");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.jumpToParentNext.custom, event)) {
            jumpToParent(protyle, nodeElement, "next");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.jumpToParent.custom, event)) {
            jumpToParent(protyle, nodeElement, "parent");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.jumpToParentPrev.custom, event)) {
            jumpToParent(protyle, nodeElement, "previous");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.moveToUp.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            moveToUp(protyle, nodeElement, range);
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.moveToDown.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            moveToDown(protyle, nodeElement, range);
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.vLayout.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 1 && selectsElement[0].getAttribute("data-type") === "NodeSuperBlock") {
                if (selectsElement[0].getAttribute("data-sb-layout") === "col") {
                    const oldHTML = selectsElement[0].outerHTML;
                    selectsElement[0].setAttribute("data-sb-layout", "row");
                    selectsElement[0].setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, selectsElement[0].getAttribute("data-node-id"), selectsElement[0].outerHTML, oldHTML);
                } else {
                    range.insertNode(document.createElement("wbr"));
                    const sbData = await cancelSB(protyle, selectsElement[0]);
                    transaction(protyle, sbData.doOperations, sbData.undoOperations);
                    focusByWbr(protyle.wysiwyg.element, range);
                }
                return;
            }
            if (selectsElement.length < 2 || selectsElement[0]?.classList.contains("li")) {
                return;
            }
            turnsIntoOneTransaction({
                protyle, selectsElement,
                type: "BlocksMergeSuperBlock",
                level: "row"
            });
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.hLayout.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 1 && selectsElement[0].getAttribute("data-type") === "NodeSuperBlock") {
                if (selectsElement[0].getAttribute("data-sb-layout") === "row") {
                    const oldHTML = selectsElement[0].outerHTML;
                    selectsElement[0].setAttribute("data-sb-layout", "col");
                    selectsElement[0].setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                    updateTransaction(protyle, selectsElement[0].getAttribute("data-node-id"), selectsElement[0].outerHTML, oldHTML);
                } else {
                    range.insertNode(document.createElement("wbr"));
                    const sbData = await cancelSB(protyle, selectsElement[0]);
                    transaction(protyle, sbData.doOperations, sbData.undoOperations);
                    focusByWbr(protyle.wysiwyg.element, range);
                }
                return;
            }
            if (selectsElement.length < 2 || selectsElement[0]?.classList.contains("li")) {
                return;
            }
            turnsIntoOneTransaction({
                protyle, selectsElement,
                type: "BlocksMergeSuperBlock",
                level: "col"
            });
            return;
        }

        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.ai.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            let selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement = [nodeElement];
            }
            AIActions(selectsElement, protyle);
            return;
        }

        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.aiWriting.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            AIChat(protyle, nodeElement);
            return;
        }

        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.openInNewTab.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const blockPanel = window.siyuan.blockPanels.find(item => {
                if (item.element.contains(nodeElement)) {
                    return true;
                }
            });
            const id = nodeElement.getAttribute("data-node-id");
            checkFold(id, (zoomIn, action) => {
                openFileById({
                    app: protyle.app,
                    id,
                    action,
                    zoomIn,
                    openNewTab: true
                });
                blockPanel.destroy();
            });
            return;
        }

        // tab 需等待 list 和 table 处理完成
        if (event.key === "Tab" && isNotCtrl(event) && !event.altKey) {
            event.preventDefault();
            const tabSpace = window.siyuan.config.editor.codeTabSpaces === 0 ? "\t" : "".padStart(window.siyuan.config.editor.codeTabSpaces, " ");
            if (nodeType === "NodeCodeBlock" && selectText !== "") {
                // https://github.com/siyuan-note/siyuan/issues/12650
                if (!hasNextSibling(range.endContainer) && range.endContainer.textContent.endsWith("\n") && range.endOffset > 0) {
                    range.setEnd(range.endContainer, range.endOffset - 1);
                }
                const wbrElement = document.createElement("wbr");
                range.insertNode(wbrElement);
                range.setStartAfter(wbrElement);
                const oldHTML = nodeElement.outerHTML;
                let text = "";
                if (!event.shiftKey) {
                    range.extractContents().textContent.split("\n").forEach((item: string) => {
                        text += tabSpace + item + "\n";
                    });
                } else {
                    range.extractContents().textContent.split("\n").forEach((item: string) => {
                        if (item.startsWith(tabSpace)) {
                            text += item.replace(tabSpace, "") + "\n";
                        } else {
                            text += item + "\n";
                        }
                    });
                }
                let language = nodeElement.querySelector(".protyle-action__language").textContent;
                // 语言优先级处理 https://github.com/siyuan-note/siyuan/issues/14767
                if (range.commonAncestorContainer.nodeType === 1) {
                    const snippetClassName = (range.commonAncestorContainer as HTMLElement).className;
                    if (snippetClassName.startsWith("language-")) {
                        language = snippetClassName.replace("language-", "");
                        // https://github.com/siyuan-note/siyuan/issues/14767
                        if (wbrElement.parentElement !== range.commonAncestorContainer) {
                            wbrElement.parentElement.after(wbrElement);
                            wbrElement.previousElementSibling.remove();
                        }
                    }
                }
                if (!window.hljs.getLanguage(language)) {
                    language = "plaintext";
                }
                wbrElement.insertAdjacentHTML("afterend", window.hljs.highlight(text.substr(0, text.length - 1), {
                    language,
                    ignoreIllegals: true
                }).value + "<br>");
                range.setStart(wbrElement.nextSibling, 0);
                const brElement = wbrElement.parentElement.querySelector("br");
                setLastNodeRange(brElement.previousSibling as Element, range, false);
                brElement.remove();
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                wbrElement.remove();
                return;
            }
            if (!event.shiftKey) {
                const inlineElement = range.startContainer.parentElement;
                const currentTypes = protyle.toolbar.getCurrentType(range);
                // https://github.com/siyuan-note/siyuan/issues/14703
                if (currentTypes.length > 0 && range.toString() === "" && range.startOffset === 0 &&
                    inlineElement.tagName === "SPAN" && !hasPreviousSibling(range.startContainer) && !hasPreviousSibling(inlineElement)) {
                    range.setStartBefore(inlineElement);
                    range.collapse(true);
                } else if (inlineElement.tagName === "SPAN" &&
                    !currentTypes.includes("search-mark") &&    // https://github.com/siyuan-note/siyuan/issues/7586
                    !currentTypes.includes("code") &&   // https://github.com/siyuan-note/siyuan/issues/13871
                    !currentTypes.includes("kbd") &&
                    !currentTypes.includes("tag") &&
                    range.toString() === "" && range.startContainer.nodeType === 3 &&
                    (currentTypes.includes("inline-memo") || currentTypes.includes("block-ref") || currentTypes.includes("file-annotation-ref") || currentTypes.includes("a")) &&
                    !hasNextSibling(range.startContainer) && range.startContainer.textContent.length === range.startOffset
                ) {
                    range.setEndAfter(inlineElement);
                    range.collapse(false);
                }
                const wbrElement = document.createElement("wbr");
                range.insertNode(wbrElement);
                const oldHTML = nodeElement.outerHTML;
                range.extractContents();
                range.insertNode(document.createTextNode(tabSpace));
                range.collapse(false);
                focusByRange(range);
                wbrElement.remove();
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                return true;
            }
        }

        if (event.key === "ContextMenu") {
            const rangePosition = getSelectionPosition(nodeElement, range);
            protyle.wysiwyg.element.dispatchEvent(new CustomEvent("contextmenu", {
                detail: {
                    target: nodeElement,
                    y: rangePosition.top + 8,
                    x: rangePosition.left
                }
            }));
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        /// #if !MOBILE
        const refElement = hasClosestByAttribute(range.startContainer, "data-type", "block-ref");
        if (refElement) {
            const id = refElement.getAttribute("data-id");
            if (matchHotKey(window.siyuan.config.keymap.editor.general.openBy.custom, event)) {
                checkFold(id, (zoomIn, action, isRoot) => {
                    if (!isRoot) {
                        action.push(Constants.CB_GET_HL);
                    }
                    openFileById({
                        app: protyle.app,
                        id,
                        action,
                        zoomIn,
                        scrollPosition: "start"
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refTab.custom, event)) {
                // 打开块引和编辑器中引用、反链、书签中点击事件需保持一致，都加载上下文
                checkFold(id, (zoomIn) => {
                    openFileById({
                        app: protyle.app,
                        id,
                        action: zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        keepCursor: true,
                        zoomIn,
                        scrollPosition: "start"
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
                checkFold(id, (zoomIn, action, isRoot) => {
                    if (!isRoot) {
                        action.push(Constants.CB_GET_HL);
                    }
                    openFileById({
                        app: protyle.app,
                        id,
                        position: "right",
                        action,
                        zoomIn,
                        scrollPosition: "start"
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.insertBottom.custom, event)) {
                checkFold(id, (zoomIn, action, isRoot) => {
                    if (!isRoot) {
                        action.push(Constants.CB_GET_HL);
                    }
                    openFileById({
                        app: protyle.app,
                        id,
                        position: "bottom",
                        action,
                        zoomIn,
                        scrollPosition: "start"
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refPopover.custom, event)) {
                // open popover
                window.siyuan.blockPanels.push(new BlockPanel({
                    app: protyle.app,
                    isBacklink: false,
                    targetElement: refElement,
                    refDefs: [{refID: id}]
                }));
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }
        /// #endif

        if (matchHotKey("⇧⌘V", event)) {
            event.returnValue = false;
            event.preventDefault();
            event.stopPropagation();
            pasteAsPlainText(protyle);
            return;
        }

        /// #if !BROWSER
        if (matchHotKey(window.siyuan.config.keymap.editor.general.showInFolder.custom, event)) {
            const aElement = hasClosestByAttribute(range.startContainer, "data-type", "a");
            if (aElement) {
                const linkAddress = aElement.getAttribute("data-href");
                if (isLocalPath(linkAddress)) {
                    openBy(linkAddress, "folder");
                    event.preventDefault();
                    event.stopPropagation();
                }
            }
            return;
        }
        /// #endif

        if (matchHotKey(window.siyuan.config.keymap.editor.general.openBy.custom, event)) {
            const aElement = hasClosestByAttribute(range.startContainer, "data-type", "a");
            if (aElement) {
                openLink(protyle, aElement.getAttribute("data-href"), undefined, false);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const fileElement = hasClosestByAttribute(range.startContainer, "data-type", "file-annotation-ref");
            if (fileElement) {
                const fileIds = fileElement.getAttribute("data-id").split("/");
                const linkAddress = `assets/${fileIds[1]}`;
                openLink(protyle, linkAddress, undefined, false);
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            return;
        }

        // 和自定义 alt+shift+左/右 冲突，降低优先级  https://github.com/siyuan-note/siyuan/issues/14638
        if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }

            if (!range.toString()) {
                if (event.key === "ArrowRight" && isEndOfBlock(range) && !isIncludesHotKey("⌥⇧→")) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                const nodeEditableElement = getContenteditableElement(nodeElement);
                const position = getSelectionOffset(nodeEditableElement, protyle.wysiwyg.element, range);
                if (position.start === 0 && event.key === "ArrowLeft" && !isIncludesHotKey("⌥⇧←")) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
            }
        }

        // 置于最后，太多快捷键会使用到选中元素
        if (isNotCtrl(event) && event.key !== "Backspace" && event.key !== "Escape" && event.key !== "Delete" && !event.shiftKey && !event.altKey && event.key !== "Enter") {
            hideElements(["select"], protyle);
        }

        if (matchHotKey("⌘B", event) || matchHotKey("⌘I", event) || matchHotKey("⌘U", event)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
    });
};
