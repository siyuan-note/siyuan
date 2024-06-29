import {matchHotKey} from "../util/hotKey";
import {fetchPost} from "../../util/fetch";
import {isMac, writeText} from "../util/compatibility";
import {focusBlock, getSelectionOffset, setFirstNodeRange, setLastNodeRange,} from "../util/selection";
import {getContenteditableElement, getNextBlock} from "./getBlock";
import {hasClosestByMatchTag} from "../util/hasClosest";
import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";
import {scrollCenter} from "../../util/highlightById";
import {transaction, updateTransaction} from "./transaction";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";
import {net2LocalAssets} from "../breadcrumb/action";
import {processClonePHElement} from "../render/util";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent, nodeElement?: HTMLElement) => {
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
        net2LocalAssets(protyle, "Img");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.netAssets2LocalAssets.custom, event)) {
        net2LocalAssets(protyle, "Assets");
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

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocolInMd.custom, event)) {
        const id = nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.rootID;
        fetchPost("/api/block/getRefText", {id}, (response) => {
            writeText(`[${response.data}](siyuan://blocks/${id})`);
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    /// #if !MOBILE
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
        const tdElement = hasClosestByMatchTag(options.range.startContainer, "TD") || hasClosestByMatchTag(options.range.startContainer, "TH");
        const nodeEditableElement = (tdElement || getContenteditableElement(options.nodeElement) || options.nodeElement) as HTMLElement;
        const startIndex = getSelectionOffset(nodeEditableElement, options.editorElement, options.range).start;
        const innerText = nodeEditableElement.innerText;
        const isExpandUp = matchHotKey(window.siyuan.config.keymap.editor.general.expandUp.custom, options.event);
        if (!isMac() && isExpandUp) {
            // Windows 中 ⌥⇧↑ 默认无选中功能会导致 https://ld246.com/article/1716635371149
        } else if (startIndex > 0) {
            // 选中上一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
            if (innerText.substr(0, startIndex).indexOf("\n") === -1 &&
                // 当第一行太长自然换行的情况
                options.range.getBoundingClientRect().top - nodeEditableElement.getBoundingClientRect().top - parseInt(getComputedStyle(nodeEditableElement).paddingTop) < 14) {
                setFirstNodeRange(nodeEditableElement, options.range);
                if (!isMac()) {
                    // windows 中 shift 向上选中三行后，最后的光标会乱跳
                    options.event.preventDefault();
                }
            }
            return;
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
        const tdElement = hasClosestByMatchTag(options.range.startContainer, "TD") || hasClosestByMatchTag(options.range.startContainer, "TH");
        const nodeEditableElement = (tdElement || getContenteditableElement(options.nodeElement) || options.nodeElement) as HTMLElement;
        const endIndex = getSelectionOffset(nodeEditableElement, options.editorElement, options.range).end;
        const innerText = nodeEditableElement.innerText;
        const isExpandDown = matchHotKey(window.siyuan.config.keymap.editor.general.expandDown.custom, options.event);
        if (!isMac() && isExpandDown) {
            // Windows 中 ⌥⇧↓ 默认无选中功能会导致 https://ld246.com/article/1716635371149
        } else if (endIndex < innerText.length) {
            // 选中下一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
            if (!getNextBlock(options.nodeElement) && innerText.trimRight().substr(endIndex).indexOf("\n") === -1 &&
                // 当最后一行太长自然换行的情况
                nodeEditableElement.getBoundingClientRect().bottom - options.range.getBoundingClientRect().bottom - parseInt(getComputedStyle(nodeEditableElement).paddingBottom) < 14) {
                // 当为最后一个块时应选中末尾
                setLastNodeRange(nodeEditableElement, options.range, false);
                if (options.nodeElement.classList.contains("code-block") && isExpandDown) {
                    // 代码块中 shift+alt 向下选中到末尾时，最后一个字符无法选中
                    options.event.preventDefault();
                }
            }
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
    let focusElement: Element;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let starIndex: number;
    if (nodeElements[nodeElements.length - 1].getAttribute("data-subtype") === "o") {
        starIndex = parseInt(nodeElements[nodeElements.length - 1].getAttribute("data-marker"), 10);
    }
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
        if (typeof starIndex === "number") {
            const orderIndex = starIndex + (nodeElements.length - index);
            tempElement.setAttribute("data-marker", (orderIndex) + ".");
            tempElement.querySelector(".protyle-action--order").textContent = (orderIndex) + ".";
        }
        nodeElements[0].after(processClonePHElement(tempElement));
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
    if (typeof starIndex === "number") {
        let nextElement = focusElement.nextElementSibling;
        starIndex = starIndex + nodeElements.length;
        while (nextElement) {
            if (nextElement.getAttribute("data-subtype") === "o") {
                starIndex++;
                const id = nextElement.getAttribute("data-node-id");
                undoOperations.push({
                    action: "update",
                    id,
                    data: nextElement.outerHTML,
                });
                nextElement.setAttribute("data-marker", starIndex + ".");
                nextElement.querySelector(".protyle-action--order").textContent = starIndex + ".";
                doOperations.push({
                    action: "update",
                    data: nextElement.outerHTML,
                    id,
                });
                nextElement = nextElement.nextElementSibling;
            } else {
                break;
            }
        }
    }
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
            onGet({
                data: getResponse,
                protyle,
                action: [Constants.CB_GET_FOCUS],
                afterCB() {
                    focusBlock(protyle.wysiwyg.element.lastElementChild, undefined, false);
                }
            });
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
        item.style.minWidth = "calc(100% - 0.1em)";
    });
    updateTransaction(protyle, id, nodeElement.outerHTML, html);
};

export const alignImgLeft = (protyle: IProtyle, nodeElement: Element, assetElements: Element[], id: string, html: string) => {
    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    assetElements.forEach((item: HTMLElement) => {
        item.style.minWidth = "";
        // 兼容历史居中问题
        item.style.display = "";
    });
    updateTransaction(protyle, id, nodeElement.outerHTML, html);
};
