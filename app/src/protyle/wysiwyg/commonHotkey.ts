import type {FileTreeGetDocRequestInput} from "../../types/api";
import {matchHotKey} from "../util/hotKey";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isMac, writeText} from "../util/compatibility";
import {focusBlock, getBlockElementsByRange, getEditorRange, setFirstNodeRange} from "../util/selection";
import {getSelectionOffset, setLastNodeRange} from "../util/selectionOffsets";
import {selectTextToEditorBoundary} from "../util/selectionBoundary";
import {getVerticalCaretRect} from "./verticalCaret";
import {getContenteditableElement, getNextBlock} from "./getBlock";
import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";
import {scrollCenter} from "../../util/highlightById";
import {transaction, updateTransaction} from "./transaction";
import {onGet} from "../util/onGet";
import {Constants} from "../../constants";
import dayjs from "dayjs";
import {net2LocalAssets} from "../breadcrumb/action";
import {copyTextByType} from "../toolbar/util";
import {hasClosestBlock, hasClosestByTag, hasTopClosestByClassName} from "../util/hasClosest";
import {removeEmbed} from "./removeEmbed";
import {clearBlockElement} from "../util/clear";
import {remapTabsDOMIDs} from "../util/tabsCopy";
import {remapListMindmapIDs} from "../render/listMindmap/model";
import {isEncryptedBox} from "../../util/pathName";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../asset/html";
import {captureCommandContext} from "../../command/context";
import {dispatchPluginShortcut} from "../../command/shortcutRuntime";
import {areProtylePluginExtensionsEnabled} from "../runtimeCapabilities";
import {waitForPendingTransactions} from "../util/transactionQueue";

export const commonHotkey = (protyle: IProtyle, event: KeyboardEvent, nodeElement?: HTMLElement) => {
    const getCopyIDs = (elements: Element[]) => Array.from(new Set(elements.map(element =>
        (hasClosestBlock(element, true) || element).getAttribute("data-node-id"))));
    if (matchHotKey(window.siyuan.config.keymap.editor.general.netImg2LocalAsset, event)) {
        net2LocalAssets(protyle, "Img");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.netAssets2LocalAssets, event)) {
        net2LocalAssets(protyle, "Assets");
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.optimizeTypography, event)) {
        fetchPost("/api/format/autoSpace", {
            id: protyle.block.rootID
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath, event)) {
        fetchPost("/api/filetree/getHPathByID", {
            id: protyle.block.rootID
        }, (response) => {
            writeText(response.data);
        });
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocolInMd, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(getCopyIDs(selectElements), "protocolMd");
        } else {
            copyTextByType([protyle.block.rootID], "protocolMd");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyID, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(getCopyIDs(selectElements), "id");
        } else {
            copyTextByType([protyle.block.rootID], "id");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocol, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(getCopyIDs(selectElements), "protocol");
        } else {
            copyTextByType([protyle.block.rootID], "protocol");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }

    if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockEmbed, event)) {
        if (nodeElement) {
            const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
            if (selectElements.length === 0) {
                const range = getEditorRange(protyle.wysiwyg.element);
                if (!range.collapsed && protyle.wysiwyg.element.contains(range.commonAncestorContainer)) {
                    selectElements.push(...getBlockElementsByRange(range));
                }
            }
            if (selectElements.length === 0) {
                selectElements.push(nodeElement);
            }
            copyTextByType(getCopyIDs(selectElements), "blockEmbed");
        } else {
            copyTextByType([protyle.block.rootID], "blockEmbed");
        }
        event.preventDefault();
        event.stopPropagation();
        return true;
    }
    /// #if !MOBILE
    if (areProtylePluginExtensionsEnabled(protyle)) {
        if (dispatchPluginShortcut(protyle.app, event, "editorShortcut", () => captureCommandContext({
            app: protyle.app, source: "editorShortcut", protyle, range: protyle.toolbar.range,
        }))) {
            return true;
        }
    }
    /// #endif
};

// 扩选到块首/块尾时只移动选区焦点并保留锚点，使 ⇧↑/⇧↓ 的结果随光标位于选区首尾而变化
const extendSelectionToBlockEdge = (editableElement: HTMLElement, range: Range, toStart: boolean) => {
    if (selectTextToEditorBoundary(editableElement, toStart)) {
        return;
    }
    // 锚点不在当前块内时（例如跨块选区）直接设置范围边界
    if (toStart) {
        setFirstNodeRange(editableElement, range);
    } else {
        setLastNodeRange(editableElement, range, false);
    }
};

// 扩选应以选区活动端（光标所在端）为准：Range 按文档顺序归一化，方向只能从 Selection 判断
const getSelectionFocus = (editableElement: HTMLElement, range: Range, position: { start: number, end: number }) => {
    const selection = getSelection() as Selection & {direction?: "forward" | "backward" | "none"};
    const backward = selection?.direction === "backward" ||
        (selection?.direction !== "forward" && selection?.anchorNode === range.endContainer &&
            selection?.anchorOffset === range.endOffset);
    const caretRange = document.createRange();
    caretRange.setStart(backward ? range.startContainer : range.endContainer,
        backward ? range.startOffset : range.endOffset);
    caretRange.collapse(true);
    // 行内元素边界可能没有折叠矩形，沿相邻内容测量活动端
    return {
        index: backward ? position.start : position.end,
        rect: getVerticalCaretRect(editableElement, caretRange),
    };
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
        const position = getSelectionOffset(nodeEditableElement, options.editorElement, options.range);
        const innerText = nodeEditableElement.innerText;
        const isExpandUp = matchHotKey(window.siyuan.config.keymap.editor.general.expandUp, options.event);
        const focus = getSelectionFocus(nodeEditableElement, options.range, position);
        if (!isMac() && isExpandUp) {
            // Windows 中 ⌥⇧↑ 默认无选中功能会导致 https://ld246.com/article/1716635371149
        } else if (focus.index > 0) {
            // 光标已在块的首行时把光标收至块首，其余情况交回浏览器向上移动一行
            // 选中上一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
            if (innerText.substr(0, focus.index).indexOf("\n") === -1 &&
                // 当第一行太长自然换行的情况
                focus.rect && focus.rect.top - nodeEditableElement.getBoundingClientRect().top -
                    parseInt(getComputedStyle(nodeEditableElement).paddingTop) < 14) {
                extendSelectionToBlockEdge(nodeEditableElement, options.range, true);
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
    countBlockWord(ids, options.protyle);
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
        const position = getSelectionOffset(nodeEditableElement, options.editorElement, options.range);
        const innerText = nodeEditableElement.innerText;
        const isExpandDown = matchHotKey(window.siyuan.config.keymap.editor.general.expandDown, options.event);
        const focus = getSelectionFocus(nodeEditableElement, options.range, position);
        if (!isMac() && isExpandDown) {
            // Windows 中 ⌥⇧↓ 默认无选中功能会导致 https://ld246.com/article/1716635371149
        } else if (focus.index < innerText.length) {
            // 光标已在块的末行时把光标收至块尾，其余情况交回浏览器向下移动一行
            // 选中下一个节点的处理在 toolbar/index.ts 中 `shift+方向键或三击选中`
            if (!getNextBlock(options.nodeElement) && innerText.trimRight().substr(focus.index).indexOf("\n") === -1 &&
                // 当最后一行太长自然换行的情况
                focus.rect && nodeEditableElement.getBoundingClientRect().bottom - focus.rect.bottom -
                    parseInt(getComputedStyle(nodeEditableElement).paddingBottom) < 14) {
                // 当为最后一个块时应选中末尾
                extendSelectionToBlockEdge(nodeEditableElement, options.range, false);
                if (options.nodeElement.classList.contains("code-block") && isExpandDown) {
                    // 代码块中 shift+alt 向下选中到末尾时，最后一个字符无法选中
                    options.event.preventDefault();
                }
            } else if (tdElement) {
                extendSelectionToBlockEdge(tdElement as HTMLElement, options.range, false);
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
    countBlockWord(ids, options.protyle);
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
    // 折叠内容需要从内核读取，先等待源块的创建与编辑事务完成。
    if (!protyle.lite && nodeElements.some(item =>
        item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1" ||
        item.getAttribute("data-type") !== "NodeBlockQueryEmbed" &&
        !!item.querySelector('[data-type="NodeHeading"][fold="1"]'))) {
        const rootID = protyle.block.rootID;
        await waitForPendingTransactions(protyle);
        if (rootID !== protyle.block.rootID || nodeElements.some(item => !item.isConnected)) {
            return;
        }
    }
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
                notebook: protyle.notebookId,
            });
            if (response.code !== 0) {
                return;
            }
            const foldTempElement = document.createElement("template");
            foldTempElement.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data.dom);
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
        const copiedIDs = new Map<string, string>([[tempElement.getAttribute("data-node-id"), newId]]);
        tempElement.setAttribute("data-node-id", newId);
        tempElement.setAttribute("updated", newId.split("-")[0]);
        clearBlockElement(tempElement);
        tempElement.classList.add("protyle-wysiwyg--select");
        tempElement.querySelectorAll("[data-node-id]").forEach(childItem => {
            const subNewId = Lute.NewNodeID();
            copiedIDs.set(childItem.getAttribute("data-node-id"), subNewId);
            childItem.setAttribute("data-node-id", subNewId);
            childItem.setAttribute("updated", subNewId.split("-")[0]);
            clearBlockElement(childItem);
        });
        remapTabsDOMIDs(tempElement, copiedIDs);
        remapListMindmapIDs(tempElement, copiedIDs);
        if (typeof starIndex === "number") {
            const orderIndex = starIndex + index + 1;
            tempElement.setAttribute("data-marker", (orderIndex) + ".");
            tempElement.querySelector(".protyle-action--order").textContent = (orderIndex) + ".";
        }
        lastElement.after(tempElement);
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
            const responseHTML = await fetchSyncPost("/api/block/getHeadingChildrenDOM", {
                id: item.getAttribute("data-node-id"),
                removeFoldAttr: false,
            });
            if (responseHTML.code !== 0) {
                throw new Error(responseHTML.msg);
            }
            const foldElement = document.createElement("template");
            foldElement.innerHTML = normalizeHTMLAssetIFrameBlockDOM(responseHTML.data);
            let previousID = newId;
            Array.from(foldElement.content.children).slice(1).forEach((childItem: HTMLElement) => {
                childItem.removeAttribute("parent-heading");
                const foldedIDs = new Map<string, string>();
                childItem.querySelectorAll("[data-node-id]").forEach(subItem => {
                    const id = Lute.NewNodeID();
                    foldedIDs.set(subItem.getAttribute("data-node-id"), id);
                    subItem.setAttribute("data-node-id", id);
                    clearBlockElement(subItem);
                });
                const newChildId = Lute.NewNodeID();
                foldedIDs.set(childItem.getAttribute("data-node-id"), newChildId);
                childItem.setAttribute("data-node-id", newChildId);
                clearBlockElement(childItem);
                remapTabsDOMIDs(childItem, foldedIDs);
                remapListMindmapIDs(childItem, foldedIDs);
                doOperations.push({
                    context: {
                        ignoreProcess: "true"
                    },
                    action: "insert",
                    data: childItem.outerHTML,
                    id: newChildId,
                    previousID,
                });
                undoOperations.push({
                    action: "delete",
                    id: newChildId,
                });
                previousID = newChildId;
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
                nextElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
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

export const goHome = (protyle: IProtyle, focusEditor = true) => {
    if (protyle.wysiwyg.element.firstElementChild.getAttribute("data-node-index") === "0" ||
        protyle.wysiwyg.element.firstElementChild.getAttribute("data-eof") === "1" ||
        protyle.options.backlinkData) {
        if (focusEditor) {
            focusBlock(protyle.wysiwyg.element.firstElementChild);
        }
        protyle.contentElement.scrollTop = 0;
        protyle.scroll.lastScrollTop = 1;
    } else {
        const getDocParam: FileTreeGetDocRequestInput = {
            id: protyle.block.rootID,
            mode: 0,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            getDocParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
            onGet({
                data: getResponse,
                protyle,
                action: [Constants.CB_GET_FOCUS],
                suppressFocus: !focusEditor,
            });
        });
    }
};

export const goEnd = (protyle: IProtyle, focusEditor = true) => {
    if (!protyle.scroll.element.classList.contains("fn__none") &&
        protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2") {
        const getDocParam: FileTreeGetDocRequestInput = {
            id: protyle.block.rootID,
            mode: 4,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        };
        if (isEncryptedBox(protyle.notebookId)) {
            getDocParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/filetree/getDoc", getDocParam, getResponse => {
            onGet({
                data: getResponse,
                protyle,
                action: [Constants.CB_GET_FOCUS],
                suppressFocus: !focusEditor,
                afterCB() {
                    if (focusEditor) {
                        focusBlock(protyle.wysiwyg.element.lastElementChild, undefined, false);
                    }
                }
            });
        });
    } else {
        protyle.contentElement.scrollTop = protyle.contentElement.scrollHeight;
        protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop;
        if (focusEditor) {
            focusBlock(protyle.wysiwyg.element.lastElementChild, undefined, false);
        }
    }
};

export const alignImgCenter = (protyle: IProtyle, nodeElement: Element, assetElements: Element[], id: string, html: string) => {
    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    assetElements.forEach((item: HTMLElement) => {
        item.style.minWidth = "calc(100% - 0.1em)";
    });
    updateTransaction(protyle, nodeElement, html);
};

export const alignImgLeft = (protyle: IProtyle, nodeElement: Element, assetElements: Element[], id: string, html: string) => {
    nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    assetElements.forEach((item: HTMLElement) => {
        item.removeAttribute("style");
    });
    updateTransaction(protyle, nodeElement, html);
};
