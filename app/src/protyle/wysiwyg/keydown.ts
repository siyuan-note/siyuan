import {hideElements} from "../ui/hideElements";
import {copyPlainText, isCtrl, isMac, writeText} from "../util/compatibility";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset, getSelectionPosition,
    selectAll,
} from "../util/selection";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByMatchTag,
    hasTopClosestByAttribute
} from "../util/hasClosest";
import {removeBlock} from "./remove";
import {
    getContenteditableElement,
    getFirstBlock,
    getLastBlock,
    getNextBlock,
    getPreviousBlock,
    getTopAloneElement,
    hasNextSibling,
    hasPreviousSibling,
    isNotEditBlock,
} from "./getBlock";
import {matchHotKey} from "../util/hotKey";
import {enter} from "./enter";
import {fixTable} from "../util/table";
import {
    turnsIntoOneTransaction, turnsIntoTransaction,
    updateBatchTransaction,
    updateTransaction
} from "./transaction";
import {fontEvent} from "../toolbar/Font";
import {listIndent, listOutdent} from "./list";
import {newFileContentBySelect, rename, replaceFileName} from "../../editor/rename";
import {insertEmptyBlock, jumpToParentNext} from "../../block/util";
import {isLocalPath, pathPosix} from "../../util/pathName";
/// #if !MOBILE
import {openBy, openFileById} from "../../editor/util";
/// #endif
import {
    alignImgCenter, alignImgLeft,
    commonHotkey,
    downSelect,
    duplicateBlock,
    getStartEndElement,
    goEnd,
    goHome,
    upSelect
} from "./commonHotkey";
import {enterBack, fileAnnotationRefMenu, linkMenu, refMenu, setFold, tagMenu, zoomOut} from "../../menus/protyle";
import {removeEmbed} from "./removeEmbed";
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
import {getSavePath} from "../../util/newFile";
import {escapeHtml} from "../../util/escape";
import {insertHTML} from "../util/insertHTML";
import {quickMakeCard} from "../../card/makeCard";
import {removeSearchMark} from "../toolbar/util";
import {copyPNG} from "../../menus/util";

export const keydown = (protyle: IProtyle, editorElement: HTMLElement) => {
    editorElement.addEventListener("keydown", (event: KeyboardEvent & { target: HTMLElement }) => {
        if (event.target.localName === "protyle-html") {
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
        let range = getEditorRange(protyle.wysiwyg.element);
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
            return;
        }

        // https://ld246.com/article/1694506408293
        const endElement = hasClosestBlock(range.endContainer);
        if (!matchHotKey("⌘C", event) && endElement && !nodeElement.isSameNode(endElement)) {
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (nodeElement.classList.contains("av")) {
            if (matchHotKey("⌘B", event) || matchHotKey("⌘I", event) || matchHotKey("⌘U", event)) {
                event.preventDefault();
            }
            return;
        }
        if (nodeElement.classList.contains("protyle-wysiwyg--select") && !isCtrl(event) && !event.shiftKey && !event.altKey) {
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
        if (!isCtrl(event) && !event.shiftKey && !event.altKey) {
            if (event.code === "Slash") {
                protyle.hint.enableSlash = true;
            } else if (event.code === "Backslash") {
                protyle.hint.enableSlash = false;
                hideElements(["hint"], protyle);
                // 此处不能返回，否则无法撤销 https://github.com/siyuan-note/siyuan/issues/2795
            }
        }

        // 有可能输入 shift+. ，因此需要使用 event.key 来进行判断
        if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" && event.key.indexOf("Arrow") === -1 &&
            event.key !== "Escape" && event.key !== "Shift" && event.key !== "Meta" && event.key !== "Alt" && event.key !== "Control" && event.key !== "CapsLock" &&
            !isNotEditBlock(nodeElement) &&
            !/^F\d{1,2}$/.test(event.key) && typeof protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] === "undefined") {
            const cloneRange = range.cloneRange();
            range.insertNode(document.createElement("wbr"));
            protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = nodeElement.outerHTML;
            nodeElement.querySelector("wbr").remove();
            // 光标位于引用结尾后 ctrl+b 偶尔会失效
            range = cloneRange;
        }

        if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
            (event.code.startsWith("Arrow") || event.code === "Enter") &&
            !event.altKey && !event.shiftKey && !isCtrl(event)) {
            event.preventDefault();
            return;
        } else if (event.key !== "Escape") {
            window.siyuan.menus.menu.remove();
        }

        if (!["Alt", "Meta", "Shift", "Control", "CapsLock", "Escape"].includes(event.key) && protyle.options.render.breadcrumb) {
            protyle.breadcrumb.hide();
        }

        if (!event.altKey && !event.shiftKey && !isCtrl(event) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
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
                    } else if (protyle.title && (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
                        protyle.contentElement.scrollTop === 0)) {
                        protyle.title.editElement.focus();
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
            !isCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey && !/^F\d{1,2}$/.test(event.key) &&
            event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key !== "Delete" && event.key !== "ContextMenu") {
            event.stopPropagation();
            hideElements(["select"], protyle);
            return false;
        }
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
                } else if (nodeElement.getAttribute("data-type") === "NodeHeading") {
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
                } else if (nodeElement.getAttribute("data-type") === "NodeHeading") {
                    setFold(protyle, nodeElement, true);
                } else {
                    setFold(protyle, getTopAloneElement(nodeElement), true);
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey("⇧←", event) || matchHotKey("⇧→", event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.stopPropagation();
                event.preventDefault();
                return;
            }
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
                    } else if (!selectElements[0].parentElement.classList.contains("protyle-wysiwyg")) {
                        hideElements(["select"], protyle);
                        selectElements[0].parentElement.classList.add("protyle-wysiwyg--select");
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
                    } else if (!selectLastElement.parentElement.classList.contains("protyle-wysiwyg")) {
                        hideElements(["select"], protyle);
                        selectLastElement.parentElement.classList.add("protyle-wysiwyg--select");
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
                        } else if (!startEndElement.endElement.parentElement.classList.contains("protyle-wysiwyg")) {
                            hideElements(["select"], protyle);
                            startEndElement.endElement.parentElement.classList.add("protyle-wysiwyg--select");
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
                protyle, event, nodeElement, editorElement, range,
                cb(selectElements) {
                    const startEndElement = getStartEndElement(selectElements);
                    if (startEndElement.startElement.getBoundingClientRect().top <= startEndElement.endElement.getBoundingClientRect().top) {
                        const nextElement = startEndElement.endElement.nextElementSibling as HTMLElement;
                        if (nextElement && nextElement.getAttribute("data-node-id")) {
                            nextElement.classList.add("protyle-wysiwyg--select");
                            nextElement.setAttribute("select-end", "true");
                            startEndElement.endElement.removeAttribute("select-end");
                            const bottom = nextElement.getBoundingClientRect().bottom - protyle.contentElement.getBoundingClientRect().bottom;
                            if (bottom > 0) {
                                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + bottom;
                                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
                            }
                        } else if (!startEndElement.endElement.parentElement.classList.contains("protyle-wysiwyg")) {
                            hideElements(["select"], protyle);
                            startEndElement.endElement.parentElement.classList.add("protyle-wysiwyg--select");
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
            let topNodeElement = getTopAloneElement(nodeElement);
            if (topNodeElement.parentElement.classList.contains("li") && topNodeElement.parentElement.parentElement.classList.contains("list") &&
                topNodeElement.nextElementSibling?.classList.contains("list") && topNodeElement.previousElementSibling.classList.contains("protyle-action")) {
                topNodeElement = topNodeElement.parentElement;
            }
            zoomOut({protyle, id: topNodeElement.getAttribute("data-node-id")});
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.enterBack.custom, event)) {
            enterBack(protyle, nodeElement.getAttribute("data-node-id"));
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if ((event.shiftKey && !event.altKey && !isCtrl(event) && (event.key === "Home" || event.key === "End") && isMac()) ||
            (event.shiftKey && !event.altKey && isCtrl(event) && (event.key === "Home" || event.key === "End") && !isMac())) {
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
        // ctrl+home 光标移动到顶
        if (!event.altKey && !event.shiftKey && isCtrl(event) && event.key === "Home") {
            goHome(protyle);
            hideElements(["select"], protyle);
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // ctrl+end 光标移动到尾
        if (!event.altKey && !event.shiftKey && isCtrl(event) && event.key === "End") {
            goEnd(protyle);
            hideElements(["select"], protyle);
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // 向上/下滚动一屏
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && (event.key === "PageUp" || event.key === "PageDown")) {
            if (event.key === "PageUp") {
                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop - protyle.contentElement.clientHeight;
                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop + 1;
            } else {
                protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + protyle.contentElement.clientHeight;
                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop - 1;
            }
            const contentRect = protyle.contentElement.getBoundingClientRect();
            let centerElement = document.elementFromPoint(contentRect.x + contentRect.width / 2, contentRect.y + contentRect.height / 2);
            if (centerElement.classList.contains("protyle-wysiwyg")) {
                centerElement = document.elementFromPoint(contentRect.x + contentRect.width / 2, contentRect.y + contentRect.height / 2 + Constants.SIZE_TOOLBAR_HEIGHT);
            }
            const centerBlockElement = hasClosestBlock(centerElement);
            if (centerBlockElement && !centerBlockElement.isSameNode(nodeElement)) {
                focusBlock(centerBlockElement, undefined, false);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // hint: 上下、回车选择
        if (!event.altKey && !event.shiftKey &&
            ((event.key.indexOf("Arrow") > -1 && !isCtrl(event)) || event.key === "Enter") &&
            !protyle.hint.element.classList.contains("fn__none") && protyle.hint.select(event, protyle)) {
            event.stopPropagation();
            event.preventDefault();
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
                        protyle.toolbar.showRender(protyle, previousSibling);
                        return;
                    } else if (!previousSibling &&
                        range.startContainer.parentElement.previousSibling &&
                        range.startContainer.parentElement.previousSibling.isSameNode(range.startContainer.parentElement.previousElementSibling) &&
                        range.startContainer.parentElement.previousElementSibling.getAttribute("data-type")?.indexOf("inline-math") > -1
                    ) {
                        protyle.toolbar.showRender(protyle, range.startContainer.parentElement.previousElementSibling);
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
            window.siyuan.menus.menu.popup({x: rect.left, y: rect.top}, true);
            return;
        }

        if (fixTable(protyle, event, range)) {
            event.preventDefault();
            return;
        }
        const selectText = range.toString();
        // 上下左右光标移动
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && !event.isComposing && (event.key.indexOf("Arrow") > -1)) {
            // 需使用 editabled，否则代码块会把语言字数算入
            const nodeEditableElement = getContenteditableElement(nodeElement) || nodeElement;
            const position = getSelectionOffset(nodeEditableElement, protyle.wysiwyg.element, range);
            const tdElement = hasClosestByMatchTag(range.startContainer, "TD");
            if (event.key === "ArrowDown" && nodeEditableElement?.textContent.trimRight().substr(position.start).indexOf("\n") === -1 && (
                (tdElement && !tdElement.parentElement.nextElementSibling && nodeElement.getAttribute("data-type") === "NodeTable" && !getNextBlock(nodeElement)) ||
                (nodeElement.getAttribute("data-type") === "NodeCodeBlock" && !getNextBlock(nodeElement)) ||
                (nodeElement.parentElement.getAttribute("data-type") === "NodeBlockquote" && nodeElement.nextElementSibling.classList.contains("protyle-attr") && !getNextBlock(nodeElement.parentElement))
            )) {
                // 跳出代码块和bq
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeBlockquote") {
                    insertEmptyBlock(protyle, "afterend", nodeElement.parentElement.getAttribute("data-node-id"));
                } else {
                    insertEmptyBlock(protyle, "afterend", nodeElement.getAttribute("data-node-id"));
                }
            } else if (event.key === "ArrowUp") {
                const firstEditElement = getContenteditableElement(protyle.wysiwyg.element.firstElementChild);
                if ((
                        !getPreviousBlock(nodeElement) &&  // 列表第一个块为嵌入块，第二个块为段落块，上键应选中第一个块 https://ld246.com/article/1652667912155
                        nodeElement.contains(firstEditElement)
                    ) ||
                    (!firstEditElement && nodeElement.isSameNode(protyle.wysiwyg.element.firstElementChild))) {
                    // 不能用\n判断，否则文字过长折行将错误 https://github.com/siyuan-note/siyuan/issues/6156
                    if (getSelectionPosition(nodeElement, range).top - protyle.wysiwyg.element.getBoundingClientRect().top < 40) {
                        if (protyle.title && (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
                            protyle.contentElement.scrollTop === 0)) {
                            protyle.title.editElement.focus();
                        } else {
                            protyle.contentElement.scrollTop = 0;
                            protyle.scroll.lastScrollTop = 8;
                        }
                    }
                } else {
                    if (nodeEditableElement?.textContent.substr(0, position.end).indexOf("\n") === -1) {
                        let previousElement: HTMLElement = getPreviousBlock(nodeElement) as HTMLElement;
                        if (previousElement) {
                            previousElement = getLastBlock(previousElement) as HTMLElement;
                            if (previousElement) {
                                const foldElement = hasClosestByAttribute(previousElement, "fold", "1") as HTMLElement;
                                // 代码块或以软换行结尾的块移动光标 ↑ 会跳过 https://github.com/siyuan-note/siyuan/issues/5498
                                if (getContenteditableElement(previousElement)?.textContent.endsWith("\n") && !foldElement) {
                                    focusBlock(previousElement, undefined, false);
                                    scrollCenter(protyle, previousElement);
                                    event.stopPropagation();
                                    event.preventDefault();
                                } else if (foldElement && foldElement.getAttribute("data-type") !== "NodeListItem") {
                                    // 遇到折叠块
                                    foldElement.scrollTop = 0;
                                    focusBlock(foldElement, undefined, true);
                                    scrollCenter(protyle, foldElement);
                                    event.stopPropagation();
                                    event.preventDefault();
                                }
                            }
                        }
                    }
                }
            } else if (selectText === "" && (event.key === "ArrowDown" || event.key === "ArrowRight") && nodeElement.isSameNode(getLastBlock(protyle.wysiwyg.element.lastElementChild)) &&
                // 表格无法右移动 https://ld246.com/article/1631434502215
                !hasClosestByMatchTag(range.startContainer, "TD") && !hasClosestByMatchTag(range.startContainer, "TH")) {
                // 页面按向下/右箭头丢失焦点 https://ld246.com/article/1629954026096
                const lastEditElement = getContenteditableElement(nodeElement);
                // 代码块需替换最后一个 /n  https://github.com/siyuan-note/siyuan/issues/3221
                if (lastEditElement && lastEditElement.textContent.replace(/\n$/, "").length <= getSelectionOffset(lastEditElement, undefined, range).end) {
                    event.stopPropagation();
                    event.preventDefault();
                    focusByRange(range);
                }
            } else if (selectText === "" && event.key === "ArrowLeft" && nodeElement.isSameNode(getFirstBlock(protyle.wysiwyg.element.firstElementChild))) {
                // 页面向左箭头丢失焦点 https://github.com/siyuan-note/siyuan/issues/2768
                const firstEditElement = getContenteditableElement(nodeElement);
                if (firstEditElement && getSelectionOffset(firstEditElement, undefined, range).start === 0) {
                    event.stopPropagation();
                    event.preventDefault();
                    focusByRange(range);
                }
            }
            if (event.key === "ArrowDown") {
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
                } else if (nodeEditableElement?.textContent.substr(position.end + 1).indexOf("\n") === -1) {
                    // 下一个块是折叠块
                    const nextFoldElement = getNextBlock(nodeElement) as HTMLElement;
                    if (nextFoldElement && nextFoldElement.getAttribute("fold") === "1") {
                        focusBlock(nextFoldElement);
                        scrollCenter(protyle, nextFoldElement);
                        event.stopPropagation();
                        event.preventDefault();
                    }
                }
            }
            return;
        }

        // 删除，不可使用 !isCtrl(event)，否则软删除回导致 https://github.com/siyuan-note/siyuan/issues/5607
        // 不可使用 !event.shiftKey，否则 https://ld246.com/article/1666434796806
        if (!event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
            if (protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
                removeBlock(protyle, nodeElement, range);
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
            // 行首转义符前删除 https://github.com/siyuan-note/siyuan/issues/6092
            if (range.startOffset === 0 && selectText === "" &&
                previousSibling && previousSibling.parentElement.getAttribute("data-type")?.indexOf("backslash") > -1 &&
                previousSibling.nodeType !== 3 && (previousSibling as HTMLElement).outerHTML === "<span>\\</span>" &&
                !hasPreviousSibling(previousSibling.parentElement)) {
                range.setStartBefore(previousSibling.parentElement);
                removeBlock(protyle, nodeElement, range);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            // 光标位于转义符前 F5 后，rang 和点击后的不同，也需进行判断
            if (range.startOffset === 1 && range.startContainer.nodeType !== 3 &&
                range.startContainer.parentElement.getAttribute("data-type")?.indexOf("backslash") > -1 &&
                !hasPreviousSibling(range.startContainer.parentElement)) {
                range.setStartBefore(range.startContainer.parentElement);
                removeBlock(protyle, nodeElement, range);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            const imgSelectElement = protyle.wysiwyg.element.querySelector(".img--select");
            if (imgSelectElement) {
                imgSelectElement.classList.remove("img--select");
                if (nodeElement.contains(imgSelectElement)) {
                    imgSelectElement.insertAdjacentHTML("afterend", "<wbr>");
                    const oldHTML = nodeElement.outerHTML;
                    imgSelectElement.remove();
                    updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                    focusByWbr(nodeElement, range);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
            } else if (selectText === "") {
                const editElement = getContenteditableElement(nodeElement);
                if (!editElement) {
                    nodeElement.classList.add("protyle-wysiwyg--select");
                    removeBlock(protyle, nodeElement, range);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                const position = getSelectionOffset(editElement, protyle.wysiwyg.element, range);
                if (event.key === "Delete") {
                    // 段末反向删除 https://github.com/siyuan-note/insider/issues/274
                    if (position.end === editElement.textContent.length) {
                        const nextElement = getNextBlock(getTopAloneElement(nodeElement));
                        if (nextElement) {
                            const nextRange = focusBlock(nextElement);
                            if (nextRange) {
                                const nextBlockElement = hasClosestBlock(nextRange.startContainer);
                                if (nextBlockElement) {
                                    removeBlock(protyle, nextBlockElement, nextRange);
                                }
                            }
                            event.stopPropagation();
                            event.preventDefault();
                            return;
                        }
                    } else if (position.end === editElement.textContent.length - 1 && nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                } else {
                    const currentNode = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement;
                    if (position.start === 0 && (
                        range.startOffset === 0 ||
                        (currentNode && currentNode.nodeType === 3 && !hasPreviousSibling(currentNode) && currentNode.textContent === "") // https://ld246.com/article/1649251218696
                    )) {
                        removeBlock(protyle, nodeElement, range);
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    if (range.startContainer.nodeType !== 3 &&
                        nodeElement.getAttribute("data-type") === "NodeTable" &&
                        (range.startContainer as HTMLElement).children[range.startOffset - 1]?.tagName === "TABLE") {
                        nodeElement.classList.add("protyle-wysiwyg--select");
                        removeBlock(protyle, nodeElement, range);
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    // 图片后为 br，在 br 后删除 https://github.com/siyuan-note/siyuan/issues/4963
                    if (currentNode && currentNode.nodeType !== 3 && currentNode.classList.contains("img")) {
                        range.insertNode(document.createElement("wbr"));
                        const oldHTML = nodeElement.outerHTML;
                        currentNode.remove();
                        updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                        focusByWbr(nodeElement, range);
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                    // 代码块中空行 ⌘+Del 异常 https://ld246.com/article/1663166544901
                    if (nodeElement.classList.contains("code-block") && isCtrl(event) &&
                        range.startContainer.nodeType === 3 && range.startContainer.textContent.substring(range.startOffset - 1, range.startOffset) === "\n") {
                        event.stopPropagation();
                        event.preventDefault();
                        return;
                    }
                }
            } else if (nodeElement.classList.contains("code-block") && getContenteditableElement(nodeElement).textContent === "\n") {
                // 空代码块全选删除异常 https://github.com/siyuan-note/siyuan/issues/6706
                range.collapse(true);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
        }

        // 软换行
        if (matchHotKey("⇧↩", event) && selectText === "") {
            let startElement = range.startContainer as HTMLElement;
            const nextSibling = hasNextSibling(startElement) as Element;
            // 图片之前软换行
            if (nextSibling && nextSibling.nodeType !== 3 && nextSibling.classList.contains("img")) {
                nextSibling.insertAdjacentHTML("beforebegin", "<wbr>");
                const oldHTML = nodeElement.outerHTML;
                nextSibling.previousElementSibling.remove();
                const newlineNode = document.createTextNode("\n");
                startElement.after(document.createTextNode(Constants.ZWSP));
                startElement.after(newlineNode);
                range.selectNode(newlineNode);
                range.collapse(false);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            // 行内元素软换行 https://github.com/siyuan-note/insider/issues/886
            if (startElement.nodeType === 3) {
                startElement = startElement.parentElement;
            }
            if (startElement && protyle.toolbar.getCurrentType(range).length > 0 &&
                getSelectionOffset(startElement, startElement, range).end === startElement.textContent.length) {
                startElement.insertAdjacentHTML("afterend", "<wbr>");
                const oldHTML = nodeElement.outerHTML;
                startElement.nextElementSibling.remove();
                if (!hasNextSibling(startElement)) {
                    startElement.after(document.createTextNode("\n"));
                }
                const newlineNode = document.createTextNode("\n");
                startElement.after(newlineNode);
                range.selectNode(newlineNode);
                range.collapse(false);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
            if (window.siyuan.config.system.container === "ios") {
                // iPad shift+enter 无效
                startElement = range.startContainer as HTMLElement;
                const nextSibling = hasNextSibling(startElement);
                if (nextSibling && nextSibling.textContent.trim() !== "") {
                    document.execCommand("insertHTML", false, "\n");
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
                if (!nextSibling) {
                    startElement.after(document.createTextNode("\n"));
                }
                const newlineNode = document.createTextNode("\n");
                startElement.after(newlineNode);
                const newlineNextSibling = hasNextSibling(newlineNode);
                if (newlineNextSibling && newlineNextSibling.textContent === "\n") {
                    range.setStart(newlineNextSibling, 0);
                } else {
                    range.setStart(newlineNode, 0);
                }
                range.collapse(false);
                focusByRange(range);
                event.stopPropagation();
                event.preventDefault();
                return;
            }
        }

        // 回车
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && event.key === "Enter") {
            event.stopPropagation();
            event.preventDefault();
            enter(nodeElement, range, protyle);
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

        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocol.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            let actionElement;
            if (selectElements.length === 1) {
                actionElement = selectElements[0];
            } else {
                actionElement = nodeElement;
            }
            writeText(`siyuan://blocks/${actionElement.getAttribute("data-node-id")}`);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        /// #if !MOBILE
        if (commonHotkey(protyle, event)) {
            return true;
        }
        /// #endif
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyID.custom, event)) {
            writeText(nodeElement.getAttribute("data-node-id"));
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyText.custom, event)) {
            // 用于标识复制文本 *
            if (selectText !== "") {
                // 和复制块引用保持一致 https://github.com/siyuan-note/siyuan/issues/9093
                writeText(`${Lute.EscapeHTMLStr(selectText)} ((${nodeElement.getAttribute("data-node-id")} "*"))`);
            } else {
                nodeElement.setAttribute("data-reftext", "true");
                focusByRange(getEditorRange(nodeElement));
                document.execCommand("copy");
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockRef.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            let actionElement;
            if (selectElements.length === 1) {
                actionElement = selectElements[0];
            } else {
                const selectImgElement = nodeElement.querySelector(".img--select");
                if (selectImgElement) {
                    copyPNG(selectImgElement.querySelector("img"));
                    return true;
                }
                actionElement = nodeElement;
            }
            const actionElementId = actionElement.getAttribute("data-node-id");
            if (selectText !== "") {
                writeText(`((${actionElementId} "${Lute.EscapeHTMLStr(selectText)}"))`);
            } else {
                fetchPost("/api/block/getRefText", {id: actionElementId}, (response) => {
                    writeText(`((${actionElementId} '${response.data}'))`);
                });
            }
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockEmbed.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            let actionElement;
            if (selectElements.length === 1) {
                actionElement = selectElements[0];
            } else {
                actionElement = nodeElement;
            }
            writeText(`{{select * from blocks where id='${actionElement.getAttribute("data-node-id")}'}}`);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.quickMakeCard.custom, event)) {
            const selectElement: Element[] = [];
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                selectElement.push(item);
            });
            if (selectElement.length === 0) {
                selectElement.push(nodeElement);
            }
            quickMakeCard(protyle, selectElement);
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
                const oldHTML = topElement.outerHTML;
                const name = Lute.EscapeHTMLStr(selectText);
                const nameElement = topElement.lastElementChild.querySelector(".protyle-attr--name");
                if (nameElement) {
                    nameElement.innerHTML = `<svg><use xlink:href="#iconN"></use></svg>${name}`;
                } else {
                    topElement.lastElementChild.insertAdjacentHTML("afterbegin", `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${name}</div>`);
                }
                topElement.setAttribute("name", name);
                updateTransaction(protyle, topElement.getAttribute("data-node-id"), topElement.outerHTML, oldHTML);
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

        if (matchHotKey(window.siyuan.config.keymap.editor.general.newNameFile.custom, event)) {
            if (!selectText.trim() && (nodeElement.querySelector("tr") || nodeElement.querySelector("span"))) {
                // 没选中时，都是纯文本就创建子文档 https://ld246.com/article/1663073488381/comment/1664804353295#comments
            } else {
                if (!selectText.trim() &&
                    getContenteditableElement(nodeElement).textContent  // https://github.com/siyuan-note/siyuan/issues/8099
                ) {
                    selectAll(protyle, nodeElement, range);
                }
                const newFileName = replaceFileName(selectText.trim() ? selectText.trim() : protyle.lute.BlockDOM2Content(nodeElement.outerHTML).replace(/\n/g, "")) || "Untitled";
                fetchPost("/api/filetree/getHPathByPath", {
                    notebook: protyle.notebookId,
                    path: protyle.path,
                }, (response) => {
                    fetchPost("/api/filetree/createDocWithMd", {
                        notebook: protyle.notebookId,
                        path: pathPosix().join(response.data, newFileName),
                        parentID: protyle.block.rootID,
                        markdown: ""
                    }, response => {
                        insertHTML(`<span data-type="block-ref" data-id="${response.data}" data-subtype="d">${escapeHtml(newFileName.substring(0, window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen))}</span>`, protyle);
                        hideElements(["toolbar"], protyle);
                    });
                });
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.newNameSettingFile.custom, event)) {
            if (!selectText.trim() && (nodeElement.querySelector("tr") || nodeElement.querySelector("span"))) {
                // 没选中时，都是纯文本就创建子文档 https://ld246.com/article/1663073488381/comment/1664804353295#comments
            } else {
                if (!selectText.trim() && getContenteditableElement(nodeElement).textContent) {
                    selectAll(protyle, nodeElement, range);
                }
                getSavePath(protyle.path, protyle.notebookId, (pathString) => {
                    const newFileName = replaceFileName(selectText.trim() ? selectText.trim() : protyle.lute.BlockDOM2Content(nodeElement.outerHTML).replace(/\n/g, "")) || "Untitled";
                    fetchPost("/api/filetree/createDocWithMd", {
                        notebook: protyle.notebookId,
                        path: pathPosix().join(pathString, newFileName),
                        parentID: protyle.block.rootID,
                        markdown: ""
                    }, response => {
                        insertHTML(`<span data-type="block-ref" data-id="${response.data}" data-subtype="d">${escapeHtml(newFileName.substring(0, window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen))}</span>`, protyle);
                        hideElements(["toolbar"], protyle);
                    });
                });
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
                    e.style.textAlign = "left";
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
                    e.style.textAlign = "center";
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
                e.style.textAlign = "right";
            });
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        // esc
        if (event.key === "Escape") {
            if (!protyle.toolbar.element.classList.contains("fn__none") ||
                !protyle.hint.element.classList.contains("fn__none") ||
                !protyle.toolbar.subElement.classList.contains("fn__none")) {
                hideElements(["toolbar", "hint", "util"], protyle);
                protyle.hint.enableExtend = false;
            } else if (nodeElement.classList.contains("protyle-wysiwyg--select")) {
                hideElements(["select"], protyle);
                countBlockWord([], protyle.block.rootID);
            } else if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                // 防止 ESC 时选中当前块
                window.siyuan.menus.menu.remove();
            } else {
                hideElements(["select"], protyle);
                range.collapse(false);
                nodeElement.classList.add("protyle-wysiwyg--select");
                countBlockWord([nodeElement.getAttribute("data-node-id")], protyle.block.rootID);
            }
            event.preventDefault();
            return;
        }

        // h1 - h6 hotkey
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.paragraph.custom, event)) {
            turnsIntoTransaction({
                protyle,
                nodeElement,
                type: "Blocks2Ps",
            });
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
            !["NodeCodeBlock", "NodeHeading"].includes(nodeElement.getAttribute("data-type"))) {
            const id = nodeElement.getAttribute("data-node-id");
            const html = nodeElement.outerHTML;
            const editElement = getContenteditableElement(nodeElement);
            editElement.innerHTML = "```" + window.siyuan.storage[Constants.LOCAL_CODELANG] + "\n" + editElement.textContent + "<wbr>\n```";
            const newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
            nodeElement.outerHTML = newHTML;
            const newNodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
            updateTransaction(protyle, id, newHTML, html);
            highlightRender(newNodeElement);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }

        // toolbar action
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.lastUsed.custom, event)) {
            protyle.toolbar.range = range;
            let selectElements: Element[] = [];
            if (selectText === "" && protyle.toolbar.getCurrentType(range).length === 0) {
                selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                if (selectElements.length === 0) {
                    selectElements = [nodeElement];
                }
            }
            fontEvent(protyle, selectElements);
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (!nodeElement.classList.contains("code-block") && !event.repeat &&
            !hasClosestByAttribute(nodeElement, "data-type", "NodeBlockQueryEmbed")) {
            let findToolbar = false;
            protyle.options.toolbar.find((menuItem: IMenuItem) => {
                if (!menuItem.hotkey) {
                    return false;
                }
                if (matchHotKey(menuItem.hotkey, event)) {
                    protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element);
                    if (["block-ref"].includes(menuItem.name) && protyle.toolbar.range.toString() === "") {
                        return true;
                    }
                    findToolbar = true;
                    if (["a", "block-ref", "inline-math", "inline-memo", "text"].includes(menuItem.name)) {
                        protyle.toolbar.element.querySelector(`[data-type="${menuItem.name}"]`).dispatchEvent(new CustomEvent("click"));
                    } else {
                        protyle.toolbar.setInlineMark(protyle, menuItem.name, "range");
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
            if (selectElements.length > 0 && selectElements[0].getAttribute("data-type") === "NodeListItem") {
                listOutdent(protyle, Array.from(selectElements), range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeElement.getAttribute("data-type") !== "NodeCodeBlock") {
                listOutdent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.list.indent.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0 && selectElements[0].getAttribute("data-type") === "NodeListItem") {
                listIndent(protyle, Array.from(selectElements), range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeElement.getAttribute("data-type") !== "NodeCodeBlock") {
                listIndent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.check.custom, event)) {
            protyle.hint.splitChar = "/";
            protyle.hint.lastIndex = -1;
            protyle.hint.fill("* [ ] " + Lute.Caret, protyle);
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
            insertEmptyBlock(protyle, "beforebegin");
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertAfter.custom, event)) {
            insertEmptyBlock(protyle, "afterend");
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.jumpToParentNext.custom, event)) {
            jumpToParentNext(protyle, nodeElement);
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

        if (matchHotKey("⌘C", event)) {
            let html = "";
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                html += removeEmbed(item);
            });
            if (html !== "") {
                // HTML 块选中部分内容时不写入剪切板 https://github.com/siyuan-note/siyuan/issues/5521
                // 从下往上选中 HTML 块需可以复制  https://github.com/siyuan-note/siyuan/issues/8706
                writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
            }
        }

        if (matchHotKey("⌘X", event)) {
            let html = "";
            nodeElement.classList.add("protyle-wysiwyg--select");
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            selectElements.forEach(item => {
                html += removeEmbed(item);
            });
            writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
            const nextElement = getNextBlock(selectElements[selectElements.length - 1]);
            removeBlock(protyle, nodeElement, range);
            if (nextElement) {
                focusBlock(nextElement);
            }
            event.preventDefault();
            event.stopPropagation();
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyPlainText.custom, event)) {
            if (selectText === "") {
                const selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
                let html = "";
                if (selectsElement.length === 0) {
                    selectsElement.push(nodeElement);
                }
                selectsElement.forEach(item => {
                    // 不能使用 [contenteditable="true"], 否则嵌入块无法复制
                    item.querySelectorAll("[spellcheck]").forEach(editItem => {
                        const cloneNode = editItem.cloneNode(true) as HTMLElement;
                        cloneNode.querySelectorAll('[data-type="backslash"]').forEach(slashItem => {
                            slashItem.firstElementChild.remove();
                        });
                        html += cloneNode.textContent + "\n";
                    });
                });
                copyPlainText(html.trimEnd());
            } else {
                const cloneContents = range.cloneContents();
                cloneContents.querySelectorAll('[data-type="backslash"]').forEach(item => {
                    item.firstElementChild.remove();
                });
                writeText(cloneContents.textContent);
            }
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.vLayout.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length < 2) {
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
            if (selectsElement.length < 2) {
                return;
            }
            turnsIntoOneTransaction({
                protyle, selectsElement,
                type: "BlocksMergeSuperBlock",
                level: "col"
            });
            return;
        }

        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.editor.general.duplicate.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            let selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement = [nodeElement];
            }
            duplicateBlock(selectsElement, protyle);
            return;
        }

        // tab 需等待 list 和 table 处理完成
        if (event.key === "Tab" && !event.ctrlKey && !isCtrl(event) && !event.altKey) {
            event.preventDefault();
            const tabSpace = window.siyuan.config.editor.codeTabSpaces === 0 ? "\t" : "".padStart(window.siyuan.config.editor.codeTabSpaces, " ");
            if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" && selectText !== "") {
                const wbrElement = document.createElement("wbr");
                // https://github.com/siyuan-note/siyuan/issues/8911
                if (range.startContainer.nodeType !== 3 && (range.startContainer as Element).classList.contains("protyle-action")) {
                    range.setStart(nodeElement.querySelector(".hljs").firstChild, 0);
                }
                range.insertNode(wbrElement);
                range.setStartAfter(wbrElement);
                const oldHTML = nodeElement.outerHTML;
                let text = "";
                if (!event.shiftKey) {
                    range.extractContents().textContent.split("\n").forEach((item) => {
                        text += tabSpace + item + "\n";
                    });
                } else {
                    range.extractContents().textContent.split("\n").forEach((item) => {
                        if (item.startsWith(tabSpace)) {
                            text += item.replace(tabSpace, "") + "\n";
                        } else {
                            text += item + "\n";
                        }
                    });
                }
                const insertElement = document.createElement("span");
                let language = nodeElement.querySelector(".protyle-action__language").textContent;
                if (!hljs.getLanguage(language)) {
                    language = "plaintext";
                }
                insertElement.innerHTML = hljs.highlight(text.substr(0, text.length - 1), {
                    language,
                    ignoreIllegals: true
                }).value;
                range.insertNode(insertElement);
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                wbrElement.remove();
                return;
            }
            if (!event.shiftKey) {
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
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app: protyle.app,
                        id,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: foldResponse.data
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refTab.custom, event)) {
                // 打开块引和编辑器中引用、反链、书签中点击事件需保持一致，都加载上下文
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app: protyle.app,
                        id,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        keepCursor: true,
                        zoomIn: foldResponse.data
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app: protyle.app,
                        id,
                        position: "right",
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: foldResponse.data
                    });
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.insertBottom.custom, event)) {
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app: protyle.app,
                        id,
                        position: "bottom",
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: foldResponse.data
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
                    nodeIds: [id],
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

        // 置于最后，太多快捷键会使用到选中元素
        if (!isCtrl(event) && event.key !== "Backspace" && event.key !== "Escape" && event.key !== "Delete" && !event.shiftKey && !event.altKey && event.key !== "Enter") {
            hideElements(["select"], protyle);
        }
    });
};
