import {matchHotKey} from "../util/hotKey";
import {fetchPost} from "../../util/fetch";
import {writeText} from "../util/compatibility";
import {
    focusBlock,
    focusByOffset,
    getSelectionOffset,
    setFirstNodeRange,
} from "../util/selection";
import {netImg2LocalAssets} from "../breadcrumb/action";
/// #if !MOBILE
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
/// #endif
import {getContenteditableElement, hasNextSibling, hasPreviousSibling} from "./getBlock";
import {hasClosestByMatchTag} from "../util/hasClosest";
import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";
import {scrollCenter} from "../../util/highlightById";
import {transaction, updateTransaction} from "./transaction";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath.custom, event)) {
        fetchPost("/api/filetree/getHPathByID", {
            id: protyle.block.rootID
        }, (response) => {
            writeText(response.data);
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.netImg2LocalAsset.custom, event)) {
        netImg2LocalAssets(protyle);
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.optimizeTypography.custom, event)) {
        fetchPost("/api/format/autoSpace", {
            id: protyle.block.rootID
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.spaceRepetition.custom, event) ||
        matchHotKey(window.siyuan.config.keymap.general.dailyNote.custom, event)) {
        // 阻止输入 https://ld246.com/article/1679618995926
        event.preventDefault();
        return true;
    }
    /// #if !MOBILE
    if (protyle.model) {
        if (matchHotKey(window.siyuan.config.keymap.editor.general.backlinks.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openBacklink(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.graphView.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            openGraph(protyle);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.outline.custom, event)) {
            event.preventDefault();
            event.stopPropagation();
            const offset = getSelectionOffset(target);
            openOutline(protyle);
            // switchWnd 后，range会被清空，需要重新设置
            focusByOffset(target, offset.start, offset.end);
            return true;
        }
    }

    let matchCommand = false;
    protyle.app.plugins.find(item => {
        item.commands.find(command => {
            if (command.editorCallback && matchHotKey(command.customHotkey, event)) {
                matchCommand = true;
                command.editorCallback(protyle);
                return true;
            }
        });
        if (matchCommand) {
            return true;
        }
    });
    if (matchCommand) {
        return true;
    }
    /// #endif
};

export const upSelect = (options: {
    protyle: IProtyle,
    event: KeyboardEvent,
    nodeElement: HTMLElement,
    editorElement: HTMLElement,
    range: Range,
    cb: (selectElements: NodeListOf<Element>) => void
}) => {
    const selectElements = options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (selectElements.length > 0) {
        options.event.stopPropagation();
        options.event.preventDefault();
    } else {
        if (getSelectionOffset(options.nodeElement, options.editorElement, options.range).start !== 0) {
            const editElement = getContenteditableElement(options.nodeElement);
            if (editElement.tagName === "TABLE") {
                const cellElement = hasClosestByMatchTag(options.range.startContainer, "TH") || hasClosestByMatchTag(options.range.startContainer, "TD") || editElement.querySelector("th, td");
                if (getSelectionOffset(cellElement, cellElement, options.range).start !== 0) {
                    setFirstNodeRange(cellElement, options.range);
                    options.event.stopPropagation();
                    options.event.preventDefault();
                    return;
                }
            } else {
                // 选中上一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
                return;
            }
        }
    }
    options.range.collapse(true);
    hideElements(["toolbar"], options.protyle);
    if (selectElements.length === 0) {
        options.nodeElement.classList.add("protyle-wysiwyg--select");
    } else {
        options.cb(selectElements);
    }
    const ids: string[] = [];
    options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    countBlockWord(ids, options.protyle.block.rootID);
    options.event.stopPropagation();
    options.event.preventDefault();
};

export const downSelect = (options: {
    protyle: IProtyle,
    event: KeyboardEvent,
    nodeElement: HTMLElement,
    editorElement: HTMLElement,
    range: Range,
    cb: (selectElement: NodeListOf<Element>) => void
}) => {
    const selectElements = options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
    if (selectElements.length > 0) {
        options.event.stopPropagation();
        options.event.preventDefault();
    } else {
        if (getSelectionOffset(options.nodeElement, options.editorElement, options.range).end < getContenteditableElement(options.nodeElement).textContent.length) {
            // 选中下一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
            return;
        }
    }
    options.range.collapse(false);
    hideElements(["toolbar"], options.protyle);
    if (selectElements.length === 0) {
        options.nodeElement.classList.add("protyle-wysiwyg--select");
    } else {
        options.cb(selectElements);
    }
    const ids: string[] = [];
    options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
        ids.push(item.getAttribute("data-node-id"));
    });
    countBlockWord(ids, options.protyle.block.rootID);
    options.event.stopPropagation();
    options.event.preventDefault();
};

export const getStartEndElement = (selectElements: NodeListOf<Element> | Element[]) => {
    let startElement;
    let endElement;
    selectElements.forEach(item => {
        if (item.getAttribute("select-start")) {
            startElement = item;
        }
        if (item.getAttribute("select-end")) {
            endElement = item;
        }
    });
    if (!startElement) {
        startElement = selectElements[0];
        startElement.setAttribute("select-start", "true");
    }
    if (!endElement) {
        endElement = selectElements[selectElements.length - 1];
        endElement.setAttribute("select-end", "true");
    }
    return {
        startElement,
        endElement
    };
};

export const duplicateBlock = (nodeElements: Element[], protyle: IProtyle) => {
    let focusElement;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    nodeElements.reverse().forEach((item, index) => {
        const tempElement = item.cloneNode(true) as HTMLElement;
        if (index === 0) {
            focusElement = tempElement;
        }
        const newId = Lute.NewNodeID();
        tempElement.setAttribute("data-node-id", newId);
        tempElement.querySelectorAll("[data-node-id]").forEach(childItem => {
            childItem.setAttribute("data-node-id", Lute.NewNodeID());
        });
        item.classList.remove("protyle-wysiwyg--select");
        nodeElements[0].after(tempElement);
        doOperations.push({
            action: "insert",
            data: tempElement.outerHTML,
            id: newId,
            previousID: nodeElements[0].getAttribute("data-node-id"),
        });
        undoOperations.push({
            action: "delete",
            id: newId,
        });
    });
    transaction(protyle, doOperations, undoOperations);
    focusBlock(focusElement);
    scrollCenter(protyle);
};

export const goHome = (protyle: IProtyle) => {
    if (protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-index") === "0" ||
        protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
        protyle.options.backlinkData) {
        focusBlock(protyle.wysiwyg.element.firstElementChild);
        protyle.contentElement.scrollTop = 0;
        protyle.scroll.lastScrollTop = 1;
    } else {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.rootID,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({data: getResponse, protyle, action: [Constants.CB_GET_FOCUS]});
        });
    }
};

export const goEnd = (protyle: IProtyle) => {
    if (!protyle.scroll.element.classList.contains("fn__none") &&
        protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2") {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.rootID,
            mode: 4,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({data: getResponse, protyle, action: [Constants.CB_GET_FOCUS]});
        });
    } else {
        protyle.contentElement.scrollTop = protyle.contentElement.scrollHeight;
        protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop;
        focusBlock(protyle.wysiwyg.element.lastElementChild, undefined, false);
    }
};

export const alignImgCenter = (protyle: IProtyle, nodeElement: Element, assetElements: Element[], id: string, html: string) => {
    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    assetElements.forEach((item: HTMLElement) => {
        item.style.display = "block";
        let nextSibling = item.nextSibling;
        while (nextSibling) {
            if (nextSibling.textContent === "") {
                nextSibling = nextSibling.nextSibling;
            } else if (nextSibling.textContent === Constants.ZWSP) {
                nextSibling.textContent = "";
                break;
            } else {
                break;
            }
        }
        let previous = item.previousSibling;
        while (previous) {
            if (previous.textContent === "") {
                previous = previous.previousSibling;
            } else if (previous.textContent === Constants.ZWSP) {
                previous.textContent = "";
                break;
            } else {
                break;
            }
        }
    });
    updateTransaction(protyle, id, nodeElement.outerHTML, html);
};

export const alignImgLeft = (protyle: IProtyle, nodeElement: Element, assetElements: Element[], id: string, html: string) => {
    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    assetElements.forEach((item: HTMLElement) => {
        item.style.display = "";
        if (!hasNextSibling(item)) {
            item.insertAdjacentText("afterend", Constants.ZWSP);
        }
        if (!hasPreviousSibling(item)) {
            item.insertAdjacentText("beforebegin", Constants.ZWSP);
        }
    });
    updateTransaction(protyle, id, nodeElement.outerHTML, html);
};
