import {matchHotKey} from "../util/hotKey";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isMac, writeText} from "../util/compatibility";
import {focusBlock, getSelectionOffset, setFirstNodeRange, setLastNodeRange,} from "../util/selection";
import {getContenteditableElement, getNextBlock} from "./getBlock";
import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";
import {scrollCenter} from "../../util/highlightById";
import {transaction, updateTransaction} from "./transaction";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import * as dayjs from "dayjs";
import {net2LocalAssets} from "../breadcrumb/action";
import {processClonePHElement} from "../render/util";
import {copyTextByType} from "../toolbar/util";
import {hasClosestByTag, hasTopClosestByClassName} from "../util/hasClosest";
import {removeEmbed} from "./removeEmbed";
import {clearBlockElement} from "../util/clear";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent, nodeElement?: HTMLElement) => {
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

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocolInMd.custom, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(selectElements.map(item => item.getAttribute("data-node-id")), "protocolMd");
        } else {
            copyTextByType([protyle.block.rootID], "protocolMd");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyID.custom, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(selectElements.map(item => item.getAttribute("data-node-id")), "id");
        } else {
            copyTextByType([protyle.block.rootID], "id");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocol.custom, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(selectElements.map(item => item.getAttribute("data-node-id")), "protocol");
        } else {
            copyTextByType([protyle.block.rootID], "protocol");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockEmbed.custom, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(selectElements.map(item => item.getAttribute("data-node-id")), "blockEmbed");
        } else {
            copyTextByType([protyle.block.rootID], "blockEmbed");
        }
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
        const tdElement = hasClosestByTag(options.range.startContainer, "TD") || hasClosestByTag(options.range.startContainer, "TH");
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
                options.event.preventDefault();
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
        const tdElement = hasClosestByTag(options.range.startContainer, "TD") || hasClosestByTag(options.range.startContainer, "TH");
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
            } else if (tdElement) {
                setLastNodeRange(tdElement, options.range, false);
                options.event.preventDefault();
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

export const duplicateBlock = async (nodeElements: Element[], protyle: IProtyle) => {
    let focusElement: Element;
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    let starIndex: number;
    let lastElement = nodeElements[nodeElements.length - 1];
    let isSameLi = true;
    if (lastElement.classList.contains("li")) {
        if (lastElement.getAttribute("data-subtype") === "o") {
            starIndex = parseInt(lastElement.getAttribute("data-marker"), 10);
        }
        nodeElements.find(item => {
            if (!item.classList.contains("li") ||
                lastElement.getAttribute("data-subtype") !== item.getAttribute("data-subtype")) {
                isSameLi = false;
                return true;
            }
        });
        if (!isSameLi) {
            lastElement = hasTopClosestByClassName(lastElement, "list") || lastElement;
        }
    }
    let listHTML = "";
    const foldHeadingIds = [];
    for (let index = nodeElements.length - 1; index >= 0; --index) {
        const item = nodeElements[index];
        item.classList.remove("protyle-wysiwyg--select");
        let tempElement = item.cloneNode(true) as HTMLElement;
        const newId = Lute.NewNodeID();
        if (item.getAttribute("data-type") !== "NodeBlockQueryEmbed" &&
            item.querySelector('[data-type="NodeHeading"][fold="1"]')) {
            const response = await fetchSyncPost("/api/block/getBlockDOM", {
                id: item.getAttribute("data-node-id"),
            });
            const foldTempElement = document.createElement("template");
            foldTempElement.innerHTML = response.data.dom;
            tempElement = foldTempElement.content.firstElementChild as HTMLElement;
        }
        if (item.getAttribute("data-type") === "NodeListItem" && !isSameLi) {
            if (!listHTML) {
                listHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
            }
            listHTML = removeEmbed(item) + listHTML;
            if (index === 0 ||
                nodeElements[index - 1].getAttribute("data-type") !== "NodeListItem" ||
                nodeElements[index - 1].getAttribute("data-subtype") !== item.getAttribute("data-subtype")
            ) {
                const foldTempElement = document.createElement("template");
                foldTempElement.innerHTML = `<div data-subtype="${item.getAttribute("data-subtype")}" data-node-id="${Lute.NewNodeID()}" data-type="NodeList" class="list">${listHTML}`;
                tempElement = foldTempElement.content.firstElementChild as HTMLElement;
                listHTML = "";
            } else {
                continue;
            }
        }
        if (index === nodeElements.length - 1) {
            focusElement = tempElement;
        }
        tempElement.setAttribute("data-node-id", newId);
        tempElement.setAttribute("updated", newId.split("-")[0]);
        clearBlockElement(tempElement);
        tempElement.classList.add("protyle-wysiwyg--select");
        tempElement.querySelectorAll("[data-node-id]").forEach(childItem => {
            const subNewId = Lute.NewNodeID();
            childItem.setAttribute("data-node-id", subNewId);
            childItem.setAttribute("updated", subNewId.split("-")[0]);
            clearBlockElement(childItem);
        });
        if (typeof starIndex === "number") {
            const orderIndex = starIndex + index + 1;
            tempElement.setAttribute("data-marker", (orderIndex) + ".");
            tempElement.querySelector(".protyle-action--order").textContent = (orderIndex) + ".";
        }
        lastElement.after(processClonePHElement(tempElement));
        doOperations.push({
            action: "insert",
            data: tempElement.outerHTML,
            id: newId,
            previousID: lastElement.getAttribute("data-node-id"),
        });
        undoOperations.push({
            action: "delete",
            id: newId,
        });
        if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            foldHeadingIds.push({oldId: item.getAttribute("data-node-id"), newId});
            const responseHTML = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {id: item.getAttribute("data-node-id")});
            const foldElement = document.createElement("template");
            foldElement.innerHTML = responseHTML.data;
            Array.from(foldElement.content.children).reverse().forEach((childItem: HTMLElement, childIndex) => {
                if (childIndex === foldElement.content.children.length - 1) {
                    return;
                }
                childItem.querySelectorAll("[data-node-id]").forEach(subItem => {
                    subItem.setAttribute("data-node-id", Lute.NewNodeID());
                    clearBlockElement(subItem);
                });
                const newChildId = Lute.NewNodeID();
                childItem.setAttribute("data-node-id", newChildId);
                clearBlockElement(childItem);
                doOperations.push({
                    context: {
                        ignoreProcess: "true"
                    },
                    action: "insert",
                    data: childItem.outerHTML,
                    id: newChildId,
                    previousID: newId,
                });
                undoOperations.push({
                    action: "delete",
                    id: newChildId,
                });
            });
        }
    }
    protyle.wysiwyg.element.querySelectorAll("[parent-heading]").forEach(item => {
        item.remove();
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
        item.removeAttribute("style");
    });
    updateTransaction(protyle, id, nodeElement.outerHTML, html);
};
