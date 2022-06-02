import {hideElements} from "../ui/hideElements";
import {getEventName, isCtrl, isMac, writeText} from "../util/compatibility";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset, selectAll,
    setFirstNodeRange,
    setLastNodeRange
} from "../util/selection";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByMatchTag} from "../util/hasClosest";
import {removeBlock} from "./remove";
import {
    getContenteditableElement,
    getFirstBlock,
    getLastBlock,
    getNextBlock,
    getPreviousBlock,
    getTopAloneElement, hasNextSibling, hasPrevious,
    isNotEditBlock,
} from "./getBlock";
import {matchHotKey} from "../util/hotKey";
import {fullscreen} from "../breadcrumb/action";
import {enter} from "./enter";
import {fixTable} from "../util/table";
import {phTransaction, transaction, turnsIntoTransaction, updateTransaction} from "./transaction";
import {fontEvent} from "../toolbar/Font";
import {listIndent, listOutdent, updateListOrder} from "./list";
import {newFileBySelect, newFileContentBySelect, rename, replaceFileName} from "../../editor/rename";
import {insertEmptyBlock} from "../../block/util";
import {isLocalPath} from "../../util/pathName";
/// #if !BROWSER
import {clipboard} from "electron";
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {linkMenu, refMenu, setFold, zoomOut} from "../../menus/protyle";
import {setPosition} from "../../util/setPosition";
import {removeEmbed} from "./removeEmbed";
import {openAttr} from "../../menus/commonMenuItem";
import {Constants} from "../../constants";
import {addLoading, setPadding} from "../ui/initUI";
import {preventScroll} from "../scroll/preventScroll";
import {bindMenuKeydown} from "../../menus/Menu";
import {fetchPost} from "../../util/fetch";
import {onGet} from "../util/onGet";
import {scrollCenter} from "../../util/highlightById";
import {openBacklink, openBy, openFileById, openGraph, openOutline} from "../../editor/util";
import {BlockPanel} from "../../block/Panel";
import * as dayjs from "dayjs";
import {highlightRender} from "../markdown/highlightRender";

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
        } else if (!event.repeat) {
            hideElements(["toolbar"], protyle);
        }

        if (event.isComposing) {
            event.stopPropagation();
            return;
        }

        const range = getEditorRange(protyle.wysiwyg.element);
        const nodeElement = hasClosestBlock(range.startContainer);
        if (!nodeElement) {
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
            !/^F\d{1,2}$/.test(event.key) && typeof protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] === "undefined") {
            range.insertNode(document.createElement("wbr"));
            protyle.wysiwyg.lastHTMLs[nodeElement.getAttribute("data-node-id")] = nodeElement.outerHTML;
            nodeElement.querySelector("wbr").remove();
        }

        if (bindMenuKeydown(event)) {
            event.stopPropagation();
            event.preventDefault();
            return;
        } else if (event.key !== "Escape") {
            window.siyuan.menus.menu.remove();
        }

        if (!["Alt", "Meta", "Shift", "Control", "CapsLock", "Escape"].includes(event.key)) {
            protyle.breadcrumb.hide();
        }

        if (!event.altKey && !event.shiftKey && !isCtrl(event) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.preventDefault();
                event.stopPropagation();
                selectElements.forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select");
                });
                if (event.key === "ArrowDown") {
                    const currentSelectElement = selectElements[selectElements.length - 1] as HTMLElement;
                    let nextElement = getNextBlock(currentSelectElement) as HTMLElement;
                    if (nextElement) {
                        if (nextElement.getBoundingClientRect().width === 0) {
                            // https://github.com/siyuan-note/siyuan/issues/4294
                            const foldElement = hasClosestByAttribute(nextElement, "fold", "1");
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
                        } else {
                            nextElement = getFirstBlock(nextElement) as HTMLElement;
                        }
                    } else {
                        nextElement = currentSelectElement;
                    }

                    nextElement.classList.add("protyle-wysiwyg--select");
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
                            const foldElement = hasClosestByAttribute(previousElement, "fold", "1");
                            if (foldElement) {
                                previousElement = getFirstBlock(foldElement) as HTMLElement;
                            } else {
                                previousElement = selectElements[0] as HTMLElement;
                            }
                        }
                    } else if (protyle.title && (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "true" ||
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

        if (!isCtrl(event) && event.key !== "Backspace" && event.key !== "Escape" && event.key !== "Delete" && !event.shiftKey && !event.altKey &&
            !matchHotKey(window.siyuan.config.keymap.editor.list.indent.custom, event) &&
            !matchHotKey(window.siyuan.config.keymap.editor.list.outdent.custom, event) &&
            !matchHotKey(window.siyuan.config.keymap.editor.general.newContentFile.custom, event)) {
            hideElements(["select"], protyle);
        }

        if (range.toString() !== "") {
            // 选中后继续输入 https://ld246.com/article/1626710391372
            if (protyle.toolbar.getCurrentType(range).length > 0) {
                protyle.toolbar.isNewEmptyInline = true;
            }
        }

        // 仅处理以下快捷键操作
        if (event.key !== "PageUp" && event.key !== "PageDown" && event.key !== "Home" && event.key !== "End" && event.key.indexOf("Arrow") === -1 &&
            !isCtrl(event) && event.key !== "Escape" && !event.shiftKey && !event.altKey && !/^F\d{1,2}$/.test(event.key) &&
            event.key !== "Enter" && event.key !== "Tab" && event.key !== "Backspace" && event.key !== "Delete") {
            event.stopPropagation();
            return false;
        }
        if (!isCtrl(event) && !event.shiftKey && event.key !== "Backspace" && event.key !== "PageUp" && event.key !== "PageDown" && event.key.indexOf("Arrow") === -1) {
            protyle.toolbar.isNewEmptyInline = false;
        }
        if (matchHotKey("⌘↑", event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                setFold(protyle, selectElements[0]);
            } else {
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeListItem") {
                    if (nodeElement.parentElement.querySelector(".list")) {
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
        if (matchHotKey("⌘↓", event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                setFold(protyle, selectElements[0], true);
            } else {
                if (nodeElement.parentElement.getAttribute("data-type") === "NodeListItem") {
                    if (nodeElement.parentElement.querySelector(".list")) {
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

        if (matchHotKey("⇧↑", event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.stopPropagation();
                event.preventDefault();
            }
            const start = getSelectionOffset(nodeElement, editorElement, range).start;
            if (start !== 0) {
                const editElement = getContenteditableElement(nodeElement);
                const firstIndex = editElement.textContent.indexOf("\n");
                if (firstIndex === -1 || start < firstIndex || start === editElement.textContent.replace("\n", " ").indexOf("\n")) {
                    setFirstNodeRange(editElement, range);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                } else {
                    return;
                }
            }
            range.collapse(true);
            hideElements(["toolbar"], protyle);
            if (selectElements.length === 0) {
                nodeElement.classList.add("protyle-wysiwyg--select");
            } else {
                const previousElement = selectElements[0].previousElementSibling as HTMLElement;
                if (previousElement && previousElement.getAttribute("data-node-id")) {
                    previousElement.classList.add("protyle-wysiwyg--select");
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
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (matchHotKey("⇧↓", event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                event.stopPropagation();
                event.preventDefault();
            }
            const editElement = getContenteditableElement(nodeElement);
            const end = getSelectionOffset(nodeElement, editorElement, range).end;
            if (end < editElement.textContent.length) {
                if (end > editElement.textContent.lastIndexOf("\n")) {
                    setLastNodeRange(editElement, range, false);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                } else {
                    return;
                }
            }
            range.collapse(false);
            hideElements(["toolbar"], protyle);
            const selectLastElement = selectElements[selectElements.length - 1];
            if (selectElements.length === 0) {
                nodeElement.classList.add("protyle-wysiwyg--select");
            } else {
                const nextElement = selectLastElement.nextElementSibling as HTMLElement;
                if (nextElement && nextElement.getAttribute("data-node-id")) {
                    nextElement.classList.add("protyle-wysiwyg--select");
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
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.enter.custom, event)) {
            let topNodeElement = getTopAloneElement(nodeElement);
            if (topNodeElement.parentElement.classList.contains("li") && topNodeElement.parentElement.parentElement.classList.contains("list") &&
                topNodeElement.nextElementSibling?.classList.contains("list") && topNodeElement.previousElementSibling.classList.contains("protyle-action")) {
                topNodeElement = topNodeElement.parentElement;
            }
            zoomOut(protyle, topNodeElement.getAttribute("data-node-id"));
            event.stopPropagation();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.general.enterBack.custom, event)) {
            zoomOut(protyle, protyle.block.parent2ID, nodeElement.getAttribute("data-node-id"));
            event.stopPropagation();
            return;
        }

        if (!event.altKey && !isCtrl(event) && (event.key === "Home" || event.key === "End") && isMac()) {
            const editElement = getContenteditableElement(nodeElement);
            if (editElement && editElement.tagName !== "TABLE") {
                if (!event.shiftKey) {
                    range.selectNodeContents(editElement);
                    range.collapse(event.key === "Home");
                } else {
                    if (event.key === "Home" && editElement.firstChild) {
                        range.setStartBefore(editElement.firstChild);
                    } else {
                        range.setEndAfter(editElement.lastChild);
                    }
                }
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // ctrl+home 光标移动到顶
        if (!event.altKey && !event.shiftKey && isCtrl(event) && event.key === "Home") {
            if (protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-index") === "0" ||
                protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "true") {
                focusBlock(protyle.wysiwyg.element.firstElementChild);
                protyle.contentElement.scrollTop = 0;
                protyle.scroll.lastScrollTop = 1;
            } else {
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.block.rootID,
                    mode: 0,
                    size: Constants.SIZE_GET,
                }, getResponse => {
                    onGet(getResponse, protyle, [Constants.CB_GET_FOCUS]);
                });
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        // ctrl+end 光标移动到尾
        if (!event.altKey && !event.shiftKey && isCtrl(event) && event.key === "End") {
            if (!protyle.scroll.element.classList.contains("fn__none") &&
                protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "true") {
                fetchPost("/api/filetree/getDoc", {
                    id: protyle.block.rootID,
                    mode: 4,
                    size: Constants.SIZE_GET,
                }, getResponse => {
                    onGet(getResponse, protyle, [Constants.CB_GET_FOCUS]);
                });
            } else {
                protyle.contentElement.scrollTop = protyle.contentElement.scrollHeight;
                protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop;
                focusBlock(protyle.wysiwyg.element.lastElementChild, undefined, false);
            }
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
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && (event.key.indexOf("Arrow") > -1 || event.key === "Enter") &&
            !protyle.hint.element.classList.contains("fn__none") && protyle.hint.select(event, protyle)) {
            event.stopPropagation();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.refresh.custom, event)) {
            protyle.title.render(protyle, true);
            addLoading(protyle);
            fetchPost("/api/filetree/getDoc", {
                id: protyle.block.showAll ? protyle.block.id : protyle.block.rootID,
                mode: 0,
                size: protyle.block.showAll ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
            }, getResponse => {
                onGet(getResponse, protyle, protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS]);
            });
            event.preventDefault();
            return;
        }
        if (matchHotKey("⌘/", event)) {
            event.stopPropagation();
            event.preventDefault();
            const inlineElement = hasClosestByAttribute(range.startContainer, "data-type", null);
            if (inlineElement) {
                const type = inlineElement.getAttribute("data-type");
                if (type === "block-ref") {
                    refMenu(protyle, inlineElement);
                    const rect = inlineElement.getBoundingClientRect();
                    setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + 13, 26);
                    return;
                } else if (type === "file-annotation-ref") {
                    protyle.toolbar.showFileAnnotationRef(protyle, inlineElement);
                    return;
                } else if (type === "a") {
                    linkMenu(protyle, inlineElement);
                    const rect = inlineElement.getBoundingClientRect();
                    setPosition(window.siyuan.menus.menu.element, rect.left, rect.top + 13, 26);
                    return;
                }
            }
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            let actionElement = nodeElement;
            if (selectElements.length > 0) {
                actionElement = selectElements[0] as HTMLElement;
            }
            protyle.gutter.renderMenu(protyle, actionElement);
            window.siyuan.menus.menu.element.classList.remove("fn__none");
            const rect = nodeElement.getBoundingClientRect();
            setPosition(window.siyuan.menus.menu.element, rect.left - window.siyuan.menus.menu.element.clientWidth, rect.top);
            return;
        }

        if (fixTable(protyle, event, range)) {
            event.preventDefault();
            return;
        }

        // 上下左右光标移动
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && !event.isComposing && (event.key.indexOf("Arrow") > -1)) {
            protyle.toolbar.isNewEmptyInline = false;
            protyle.hint.enableEmoji = false;
            const position = getSelectionOffset(nodeElement, protyle.wysiwyg.element, range);
            const tdElement = hasClosestByMatchTag(range.startContainer, "TD");
            if (event.key === "ArrowDown" && getContenteditableElement(nodeElement)?.textContent.trimRight().substr(position.start).indexOf("\n") === -1 && (
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
                    if (nodeElement.textContent.substr(0, getSelectionOffset(nodeElement, protyle.wysiwyg.element, range).end).indexOf("\n") === -1) {
                        if (protyle.title && (protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "true" ||
                            protyle.contentElement.scrollTop === 0)) {
                            protyle.title.editElement.focus();
                        } else {
                            protyle.contentElement.scrollTop = 0;
                            protyle.scroll.lastScrollTop = 8;
                        }
                    }
                }
            } else if (range.toString() === "" && (event.key === "ArrowDown" || event.key === "ArrowRight") && nodeElement.isSameNode(getLastBlock(protyle.wysiwyg.element.lastElementChild)) &&
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
            } else if (range.toString() === "" && event.key === "ArrowLeft" && nodeElement.isSameNode(getFirstBlock(protyle.wysiwyg.element.firstElementChild))) {
                // 页面向左箭头丢失焦点 https://github.com/siyuan-note/siyuan/issues/2768
                const firstEditElement = getContenteditableElement(nodeElement);
                if (firstEditElement && getSelectionOffset(firstEditElement, undefined, range).start === 0) {
                    event.stopPropagation();
                    event.preventDefault();
                    focusByRange(range);
                }
            }
            return;
        }

        const selectText = range.toString();
        // 删除
        if (!event.altKey && !event.shiftKey && !isCtrl(event) && (event.key === "Backspace" || event.key === "Delete")) {
            const imgSelectElement = protyle.wysiwyg.element.querySelector(".img--select");
            if (protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
                removeBlock(protyle, nodeElement, range);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (imgSelectElement) {
                imgSelectElement.insertAdjacentHTML("afterend", "<wbr>");
                imgSelectElement.classList.remove("img--select");
                const oldHTML = nodeElement.outerHTML;
                imgSelectElement.remove();
                updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, oldHTML);
                focusByWbr(nodeElement, range);
                event.stopPropagation();
                event.preventDefault();
                return;
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
                    }
                } else {
                    const currentNode = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement;
                    if (position.start === 0 && (
                        range.startOffset === 0 ||
                        (currentNode && currentNode.nodeType === 3 && !hasPrevious(currentNode) && currentNode.textContent === "") // https://ld246.com/article/1649251218696
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
                }
            }
        }

        // 软换行
        if (matchHotKey("⇧Enter", event) && range.toString() === "") {
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
            if (event.repeat) {
                return;
            }
            enter(nodeElement, range, protyle);
            return;
        }

        if (matchHotKey("⌘A", event)) {
            event.preventDefault();
            selectAll(protyle, nodeElement, range);
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.fullscreen.custom, event)) {
            fullscreen(protyle.element);
            setPadding(protyle);
            event.preventDefault();
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
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath.custom, event)) {
            fetchPost("/api/filetree/getHPathByID", {
                id: protyle.block.rootID
            }, (response) => {
                writeText(response.data);
            });
            event.preventDefault();
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockRef.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            let actionElement;
            if (selectElements.length === 1) {
                actionElement = selectElements[0];
            } else {
                actionElement = nodeElement;
            }
            const actionElementId = actionElement.getAttribute("data-node-id");
            if (selectText !== "") {
                writeText(`((${actionElementId} "${selectText}"))`);
            } else {
                fetchPost("/api/block/getRefText", {id: actionElementId}, (response) => {
                    writeText(`((${actionElementId} '${response.data}'))`);
                });
            }
            event.preventDefault();
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
                openAttr(actionElement, protyle);
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
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.rename.custom, event)) {
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
            return;
        }

        if (selectText.trim() && matchHotKey(window.siyuan.config.keymap.editor.general.newNameFile.custom, event)) {
            newFileBySelect(selectText, protyle);
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.newContentFile.custom, event)) {
            newFileContentBySelect(protyle);
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignLeft.custom, event)) {
            let actionElement: HTMLElement = nodeElement;
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                actionElement = selectElements[0] as HTMLElement;
            }
            const oldHTML = actionElement.outerHTML;
            actionElement.style.textAlign = "left";
            actionElement.querySelectorAll(".img").forEach((item: HTMLElement) => {
                item.style.display = "";
            });
            updateTransaction(protyle, actionElement.getAttribute("data-node-id"), actionElement.outerHTML, oldHTML);
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignCenter.custom, event)) {
            let actionElement: HTMLElement = nodeElement;
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                actionElement = selectElements[0] as HTMLElement;
            }
            const oldHTML = actionElement.outerHTML;
            actionElement.style.textAlign = "center";
            actionElement.querySelectorAll(".img").forEach((item: HTMLElement) => {
                item.style.display = "block";
            });
            updateTransaction(protyle, actionElement.getAttribute("data-node-id"), actionElement.outerHTML, oldHTML);
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.alignRight.custom, event)) {
            let actionElement: HTMLElement = nodeElement;
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0) {
                actionElement = selectElements[0] as HTMLElement;
            }
            const oldHTML = actionElement.outerHTML;
            actionElement.style.textAlign = "right";
            updateTransaction(protyle, actionElement.getAttribute("data-node-id"), actionElement.outerHTML, oldHTML);
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
                protyle.hint.enableEmoji = false;
            } else if (nodeElement.classList.contains("protyle-wysiwyg--select")) {
                hideElements(["select"], protyle);
            } else if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
                // 防止 ESC 时选中当前块
                window.siyuan.menus.menu.remove();
            } else {
                protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                    item.classList.remove("protyle-wysiwyg--select");
                });
                nodeElement.classList.add("protyle-wysiwyg--select");
            }
            event.preventDefault();
            return;
        }

        // h1 - h6 hotkey
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading1.custom, event)) {
            phTransaction(protyle, range, nodeElement, 1);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading2.custom, event)) {
            phTransaction(protyle, range, nodeElement, 2);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading3.custom, event)) {
            phTransaction(protyle, range, nodeElement, 3);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading4.custom, event)) {
            phTransaction(protyle, range, nodeElement, 4);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading5.custom, event)) {
            phTransaction(protyle, range, nodeElement, 5);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.heading.heading6.custom, event)) {
            phTransaction(protyle, range, nodeElement, 6);
            event.preventDefault();
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.code.custom, event) && nodeElement.getAttribute("data-type") !== "NodeCodeBlock") {
            const id = nodeElement.getAttribute("data-node-id");
            const html = nodeElement.outerHTML;
            const editElement = getContenteditableElement(nodeElement);
            editElement.innerHTML = "```" + (localStorage.getItem(Constants.LOCAL_CODELANG) || "") + "\n" + editElement.textContent + "<wbr>\n```";
            const newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
            nodeElement.outerHTML = newHTML;
            const newNodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
            updateTransaction(protyle, id, newHTML, html);
            highlightRender(newNodeElement);
            event.preventDefault();
            return true;
        }
        // toolbar action

        if (matchHotKey(window.siyuan.config.keymap.editor.insert.lastUsed.custom, event)) {
            protyle.toolbar.range = range;
            fontEvent(protyle);
            event.stopPropagation();
            event.preventDefault();
            return;
        }

        if (!nodeElement.classList.contains("code-block")) {
            const findToolbar = protyle.options.toolbar.find((menuItem: IMenuItem) => {
                if (!menuItem.hotkey) {
                    return false;
                }
                if (matchHotKey(menuItem.hotkey, event)) {
                    protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element);
                    if (menuItem.name === "font") {
                        protyle.toolbar.element.querySelector('[data-type="font"]').dispatchEvent(new CustomEvent(getEventName()));
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
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeElement.getAttribute("data-type") !== "NodeCodeBlock") {
                listOutdent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                return true;
            }
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.list.indent.custom, event)) {
            const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
            if (selectElements.length > 0 && selectElements[0].getAttribute("data-type") === "NodeListItem") {
                listIndent(protyle, Array.from(selectElements), range);
                event.preventDefault();
                return true;
            } else if (nodeElement.parentElement.classList.contains("li") && nodeElement.getAttribute("data-type") !== "NodeCodeBlock") {
                listIndent(protyle, [nodeElement.parentElement], range);
                event.preventDefault();
                return true;
            }
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.insert.check.custom, event)) {
            protyle.hint.splitChar = "/";
            protyle.hint.lastIndex = -1;
            protyle.hint.fill("* [ ] " + Lute.Caret, protyle);
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.insert.table.custom, event)) {
            protyle.hint.splitChar = "/";
            protyle.hint.lastIndex = -1;
            protyle.hint.fill(`| col1${Lute.Caret} | col2 | col3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`, protyle);
            event.preventDefault();
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
            return true;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.moveToUp.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            let previousElement: Element;
            let sourceElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (sourceElements.length === 0) {
                let sourceElement = getTopAloneElement(nodeElement);
                const foldElement = hasClosestByAttribute(sourceElement, "fold", "1");
                if (foldElement) {
                    sourceElement = foldElement;
                }
                if (sourceElement.previousElementSibling?.classList.contains("protyle-action")) {
                    sourceElement = getTopAloneElement(sourceElement.parentElement);
                }
                sourceElements = [sourceElement];
            }
            const type = sourceElements[0].getAttribute("data-type");
            // 子列表
            if (type === "NodeListItem" &&
                !sourceElements[0].previousElementSibling &&
                sourceElements[0].parentElement.previousElementSibling?.previousElementSibling?.classList.contains("protyle-action")) {
                if (sourceElements[0].parentElement.parentElement.previousElementSibling?.classList.contains("li")) {
                    previousElement = sourceElements[0].parentElement.parentElement.previousElementSibling.querySelector(".list");
                }
                if (!previousElement) {
                    return;
                }
            }
            if (type === "NodeList" &&
                sourceElements[0].previousElementSibling?.previousElementSibling?.classList.contains("protyle-action")) {
                if (sourceElements[0].parentElement.previousElementSibling?.classList.contains("li")) {
                    previousElement = sourceElements[0].parentElement.previousElementSibling.querySelector(".list");
                }
                if (!previousElement) {
                    return;
                }
            }
            if (previousElement) {
                previousElement = previousElement.lastElementChild.previousElementSibling;
                const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
                range.insertNode(document.createElement("wbr"));
                const html = previousElement.parentElement.parentElement.parentElement.outerHTML;
                sourceElements.reverse().forEach(item => {
                    if (item.classList.contains("list")) {
                        previousElement.after(item.firstElementChild);
                    } else {
                        previousElement.after(item);
                    }
                });
                if (sourceParentElement.childElementCount === 1) {
                    sourceParentElement.remove();
                } else if (sourceParentElement.getAttribute("data-subtype") === "o" && sourceParentElement.classList.contains("list")) {
                    updateListOrder(sourceParentElement, 1);
                }
                if (previousElement.getAttribute("data-subtype") === "o") {
                    updateListOrder(previousElement.parentElement);
                }

                updateTransaction(protyle, previousElement.parentElement.parentElement.parentElement.getAttribute("data-node-id"), previousElement.parentElement.parentElement.parentElement.outerHTML, html);
                preventScroll(protyle);
                scrollCenter(protyle);
                focusByWbr(previousElement.parentElement, range);
                return;
            }
            if (!sourceElements[0].previousElementSibling || sourceElements[0].previousElementSibling?.classList.contains("protyle-action")) {
                return;
            }
            previousElement = sourceElements[0].previousElementSibling;
            if (sourceElements[0].getAttribute("data-subtype") === "o" && type === "NodeListItem") {
                const html = sourceElements[0].parentElement.outerHTML;
                sourceElements[sourceElements.length - 1].after(previousElement);
                updateListOrder(sourceElements[0].parentElement, 1);
                updateTransaction(protyle, sourceElements[0].parentElement.getAttribute("data-node-id"), sourceElements[0].parentElement.outerHTML, html);
            } else {
                const id = previousElement.getAttribute("data-node-id");
                transaction(protyle, [{
                    action: "move",
                    id,
                    previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
                }], [{
                    action: "move",
                    id,
                    previousID: previousElement.previousElementSibling?.getAttribute("data-node-id"),
                    parentID: previousElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
                }]);
                sourceElements[sourceElements.length - 1].after(previousElement);
            }
            preventScroll(protyle);
            scrollCenter(protyle);
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.moveToDown.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            let nextElement: Element;
            let sourceElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (sourceElements.length === 0) {
                let sourceElement = getTopAloneElement(nodeElement);
                const foldElement = hasClosestByAttribute(sourceElement, "fold", "1");
                if (foldElement) {
                    sourceElement = foldElement;
                }
                if (sourceElement.previousElementSibling?.classList.contains("protyle-action")) {
                    sourceElement = getTopAloneElement(sourceElement.parentElement);
                }
                sourceElements = [sourceElement];
            }
            const type = sourceElements[0].getAttribute("data-type");
            // 子列表
            if (type === "NodeListItem" &&
                sourceElements[sourceElements.length - 1].nextElementSibling.classList.contains("protyle-attr") &&
                sourceElements[0].parentElement.parentElement?.classList.contains("li")) {
                if (sourceElements[0].parentElement.parentElement.nextElementSibling?.classList.contains("li")) {
                    nextElement = sourceElements[0].parentElement.parentElement.nextElementSibling.querySelector(".list > .li");
                }
                if (!nextElement) {
                    return;
                }
            }
            if (type === "NodeList" && sourceElements[sourceElements.length - 1].nextElementSibling.classList.contains("protyle-attr") &&
                sourceElements[0].parentElement?.classList.contains("li")) {
                if (sourceElements[0].parentElement.nextElementSibling?.classList.contains("li")) {
                    nextElement = sourceElements[0].parentElement.nextElementSibling.querySelector(".list > .li");
                }
                if (!nextElement) {
                    return;
                }
            }
            if (nextElement) {
                const sourceParentElement = sourceElements[0].classList.contains("list") ? sourceElements[0] : sourceElements[0].parentElement;
                range.insertNode(document.createElement("wbr"));
                const html = nextElement.parentElement.parentElement.parentElement.outerHTML;
                sourceElements.forEach(item => {
                    if (item.classList.contains("list")) {
                        nextElement.before(item.firstElementChild);
                    } else {
                        nextElement.before(item);
                    }
                });
                if (sourceParentElement.childElementCount === 1) {
                    sourceParentElement.remove();
                } else if (sourceParentElement.getAttribute("data-subtype") === "o" && sourceParentElement.classList.contains("list")) {
                    updateListOrder(sourceParentElement, 1);
                }
                if (nextElement.getAttribute("data-subtype") === "o") {
                    updateListOrder(nextElement.parentElement, 1);
                }
                updateTransaction(protyle, nextElement.parentElement.parentElement.parentElement.getAttribute("data-node-id"), nextElement.parentElement.parentElement.parentElement.outerHTML, html);
                preventScroll(protyle);
                scrollCenter(protyle);
                focusByWbr(nextElement.parentElement, range);
                return;
            }
            if (!sourceElements[sourceElements.length - 1].nextElementSibling || sourceElements[sourceElements.length - 1].nextElementSibling?.classList.contains("protyle-attr")) {
                return;
            }
            nextElement = sourceElements[sourceElements.length - 1].nextElementSibling;
            if (nextElement.getAttribute("data-subtype") === "o" && nextElement.getAttribute("data-type") === "NodeListItem") {
                const html = nextElement.parentElement.outerHTML;
                sourceElements[0].before(nextElement);
                updateListOrder(nextElement.parentElement, 1);
                updateTransaction(protyle, nextElement.parentElement.getAttribute("data-node-id"), nextElement.parentElement.outerHTML, html);
            } else {
                const id = nextElement.getAttribute("data-node-id");
                transaction(protyle, [{
                    action: "move",
                    id,
                    previousID: sourceElements[0].previousElementSibling?.getAttribute("data-node-id"),
                    parentID: nextElement.parentElement.getAttribute("data-node-id") || protyle.block.parentID
                }], [{
                    action: "move",
                    id,
                    previousID: sourceElements[sourceElements.length - 1].getAttribute("data-node-id"),
                }]);
                sourceElements[0].before(nextElement);
            }
            preventScroll(protyle);
            scrollCenter(protyle);
            return;
        }

        if (isNotEditBlock(nodeElement) && matchHotKey("⌘C", event)) {
            let html = "";
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                html += removeEmbed(item);
            });
            writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
        }

        if (isNotEditBlock(nodeElement) && matchHotKey("⌘X", event)) {
            let html = "";
            protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
                html += removeEmbed(item);
            });
            writeText(protyle.lute.BlockDOM2StdMd(html).trimEnd());
            removeBlock(protyle, nodeElement, range);
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.vLayout.custom, event)) {
            event.preventDefault();
            let selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement = [nodeElement];
            }
            turnsIntoTransaction({
                protyle, selectsElement,
                type: "BlocksMergeSuperBlock",
                level: "row"
            });
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.hLayout.custom, event)) {
            event.preventDefault();
            let selectsElement: HTMLElement[] = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectsElement.length === 0) {
                selectsElement = [nodeElement];
            }
            turnsIntoTransaction({
                protyle, selectsElement,
                type: "BlocksMergeSuperBlock",
                level: "col"
            });
            return;
        }

        // tab 需等待 list 和 table 处理完成
        if (event.key === "Tab" && !event.ctrlKey && !isCtrl(event) && !event.altKey) {
            event.preventDefault();
            const tabSpace = window.siyuan.config.editor.codeTabSpaces === 0 ? "\t" : "".padStart(window.siyuan.config.editor.codeTabSpaces, " ");
            if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" && selectText !== "") {
                const wbrElement = document.createElement("wbr");
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

        const refElement = hasClosestByAttribute(range.startContainer, "data-type", "block-ref");
        if (refElement) {
            const id = refElement.getAttribute("data-id");
            if (matchHotKey(window.siyuan.config.keymap.editor.general.refPopover.custom, event)) {
                // open popover
                window.siyuan.blockPanels.push(new BlockPanel({
                    targetElement: refElement,
                    nodeIds: [id],
                }));
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refTab.custom, event)) {
                // 打开块引和编辑器中引用、反链、书签中点击事件需保持一致，都加载上下文
                openFileById({
                    id,
                    hasContext: true,
                    keepCursor: true,
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refRight.custom, event)) {
                openFileById({
                    id,
                    position: "right",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            } else if (matchHotKey(window.siyuan.config.keymap.editor.general.refBottom.custom, event)) {
                openFileById({
                    id,
                    position: "bottom",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
                event.preventDefault();
                event.stopPropagation();
                return true;
            }
        }

        if (protyle.model) {
            if (matchHotKey(window.siyuan.config.keymap.editor.general.outline.custom, event)) {
                event.preventDefault();
                openOutline(protyle);
                return;
            }

            if (matchHotKey(window.siyuan.config.keymap.editor.general.backlinks.custom, event)) {
                event.preventDefault();
                openBacklink(protyle);
                return;
            }

            if (matchHotKey(window.siyuan.config.keymap.editor.general.graphView.custom, event)) {
                event.preventDefault();
                openGraph(protyle);
                return;
            }
        }

        /// #if !BROWSER
        if (matchHotKey(window.siyuan.config.keymap.editor.general.pasteAsPlainText.custom, event)) {
            writeText(clipboard.readText());
            setTimeout(() => {
                getCurrentWindow().webContents.pasteAndMatchStyle();
            }, 100);
            event.preventDefault();
            return;
        }

        if (matchHotKey(window.siyuan.config.keymap.editor.general.showInFolder.custom, event)) {
            const aElement = hasClosestByAttribute(range.startContainer, "data-type", "a");
            if (aElement) {
                const linkAddress = aElement.getAttribute("data-href");
                if (isLocalPath(linkAddress)) {
                    openBy(linkAddress, "folder");
                    event.preventDefault();
                }
            }
            return;
        }
        /// #endif
    });
};
