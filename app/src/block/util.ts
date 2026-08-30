import {focusByRange, focusByWbr, getEditorRange, getUndoFocusContext} from "../protyle/util/selection";
import {hasClosestBlock, hasClosestByClassName, isInEmbedBlock} from "../protyle/util/hasClosest";
import {
    getContenteditableElement,
    getEmbedChildOperationParentID,
    getParentBlock,
    getPreviousBlockSibling,
    getTopAloneElement
} from "../protyle/wysiwyg/getBlock";
import {genListItemElement, updateListOrder} from "../protyle/wysiwyg/list";
import {transaction, turnsIntoOneTransaction, updateTransaction} from "../protyle/wysiwyg/transaction";
import {scrollCenter} from "../util/highlightById";
import {Constants} from "../constants";
import {hideElements} from "../protyle/ui/hideElements";
import {blockRender} from "../protyle/render/blockRender";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {openMobileFileById} from "../mobile/editor";
import {mathRender} from "../protyle/render/mathRender";
import {buildCancelSuperBlockOperations} from "./cancelSuperBlock";
import {shouldFocusJumpTarget, shouldFocusParentDocumentTitle} from "./jumpToParent";
import {getHorizontalSuperBlockChild} from "./superBlock";

export const getCancelSBOperations = async (nodeElement: Element, options: {
    notebookID?: string,
    previousID?: string,
    parentID?: string,
    fallbackParentID?: string,
    resolveMissingPosition?: boolean,
    excludedChildIDs?: Set<string>,
}) => {
    const id = nodeElement.getAttribute("data-node-id");
    const visibleChildElements = Array.from(nodeElement.children).filter(item =>
        item.hasAttribute("data-node-id") && !options.excludedChildIDs?.has(item.getAttribute("data-node-id")));
    let operationChildElements = visibleChildElements;
    if (visibleChildElements.some(item => item.getAttribute("data-type") === "NodeHeading" &&
        item.getAttribute("fold") === "1")) {
        const response = await fetchSyncPost("/api/block/getBlockDOM", {
            id,
            notebook: options.notebookID,
        });
        const template = document.createElement("template");
        template.innerHTML = response.data?.dom || "";
        const fullSuperBlockElement = template.content.querySelector(`[data-node-id="${id}"]`);
        if (!fullSuperBlockElement) {
            return {doOperations: [], undoOperations: [], previousId: options.previousID};
        }
        operationChildElements = Array.from(fullSuperBlockElement.children).filter(item =>
            item.hasAttribute("data-node-id") && !options.excludedChildIDs?.has(item.getAttribute("data-node-id")));
    }
    const sbElement = nodeElement.cloneNode() as HTMLElement;
    sbElement.innerHTML = nodeElement.lastElementChild.outerHTML;
    let previousId = options.previousID;
    if (typeof previousId !== "string") {
        previousId = getPreviousBlockSibling(nodeElement)?.getAttribute("data-node-id");
    }
    let parentID = options.parentID || getEmbedChildOperationParentID(nodeElement) ||
        getParentBlock(nodeElement)?.getAttribute("data-node-id");
    // 缩放和反链需要接口获取
    if (!previousId && !parentID) {
        if (options.resolveMissingPosition) {
            const idData = await fetchSyncPost("/api/block/getBlockSiblingID", {
                id,
                notebook: options.notebookID,
            });
            previousId = idData.data.previous;
            parentID = idData.data.parent;
        } else {
            parentID = options.fallbackParentID;
        }
    }
    const operationData = buildCancelSuperBlockOperations({
        id,
        data: sbElement.outerHTML,
        childIDs: operationChildElements.map(item => item.getAttribute("data-node-id")),
        foldedHeadingIDs: operationChildElements.filter(item =>
            item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1"
        ).map(item => item.getAttribute("data-node-id")),
        previousID: previousId,
        parentID,
    });
    const focusId = visibleChildElements[visibleChildElements.length - 1]?.getAttribute("data-node-id") || previousId;
    return {
        ...operationData,
        previousId: focusId
    };
};

export const cancelSB = async (protyle: IProtyle, nodeElement: Element, range?: Range) => {
    nodeElement.classList.remove("protyle-wysiwyg--select");
    nodeElement.removeAttribute("select-start");
    nodeElement.removeAttribute("select-end");
    const operationData = await getCancelSBOperations(nodeElement, {
        notebookID: protyle.notebookId,
        fallbackParentID: protyle.block.rootID,
        resolveMissingPosition: protyle.block.showAll || !!protyle.options.backlinkData,
    });
    if (operationData.doOperations.length === 0) {
        return operationData;
    }
    // 先清理拖拽手柄，避免手柄被移到超级块外部。
    nodeElement.querySelectorAll(".sb__resize").forEach(handle => handle.remove());
    if (range) {
        getContenteditableElement(nodeElement)?.insertAdjacentHTML("afterbegin", "<wbr>");
    }
    nodeElement.lastElementChild.remove();
    nodeElement.replaceWith(...nodeElement.children);
    if (range) {
        focusByWbr(protyle.wysiwyg.element, range);
    }
    mathRender(protyle.wysiwyg.element);
    // 超级块内嵌入块无面包屑，需重新渲染 https://github.com/siyuan-note/siyuan/issues/7574
    operationData.doOperations.forEach(item => {
        const element = protyle.wysiwyg.element.querySelector(`[data-node-id="${item.id}"]`);
        if (element && element.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            element.removeAttribute("data-render");
            blockRender(protyle, element);
        }
    });
    return operationData;
};

export const genSBElement = (layout: string, id?: string, attrHTML?: string) => {
    const sbElement = document.createElement("div");
    sbElement.setAttribute("data-node-id", id || Lute.NewNodeID());
    sbElement.setAttribute("data-type", "NodeSuperBlock");
    sbElement.setAttribute("class", "sb");
    sbElement.setAttribute("data-sb-layout", layout);
    sbElement.innerHTML = attrHTML || `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    return sbElement;
};

// 刷新超级块横向布局下的拖拽手柄：col 布局在每两个相邻子块间插入 sb__resize，非 col 移除全部
export const refreshSbResize = (sbElement: Element) => {
    if (!sbElement || !sbElement.classList.contains("sb")) {
        return;
    }
    sbElement.querySelectorAll(":scope > .sb__resize").forEach(item => item.remove());
    if (sbElement.getAttribute("data-sb-layout") !== "col") {
        return;
    }
    const children = Array.from(sbElement.querySelectorAll(":scope > [data-node-id]"));
    for (let i = 0; i < children.length - 1; i++) {
        const handle = document.createElement("span");
        handle.setAttribute("class", "sb__resize");
        handle.setAttribute("contenteditable", "false");
        children[i].after(handle);
    }
};

// 子块进出超级块后，重新分配所有子块的宽度（按比例均摊 gap），避免 gap 不均或换行
// 仅当超级块中已有子块设置了宽度时才调整（否则保持 CSS 默认等分）
// 返回被改动的块信息（id + 改前 style），供调用方持久化
export const rebalanceSbWidth = (sbElement: Element): Array<{id: string, oldStyle: string}> => {
    if (!sbElement || sbElement.getAttribute("data-sb-layout") !== "col") {
        return [];
    }
    const children = Array.from(sbElement.querySelectorAll(":scope > [data-node-id]")) as HTMLElement[];
    if (children.length < 2) {
        return [];
    }
    // 没有任何子块设了宽度，保持 CSS 默认等分
    if (!children.some(c => c.style.width)) {
        return [];
    }
    // 读取手柄实际占用宽度（width + margin）
    const handle = sbElement.querySelector(":scope > .sb__resize") as HTMLElement;
    let gapPx = 20;
    if (handle) {
        const hs = getComputedStyle(handle);
        gapPx = handle.offsetWidth + parseFloat(hs.marginLeft) + parseFloat(hs.marginRight);
    }
    const childCount = children.length;
    const gapShare = ((childCount - 1) * gapPx) / childCount + 0.5;
    // 读取各块当前比例：有 width 的取 calc 百分比，无 width 的（新移入）按平均比例参与
    const avgRatio = 1 / childCount;
    const ratios: number[] = children.map(c => {
        const match = c.style.width.match(/calc\(([\d.]+)%/);
        return match ? parseFloat(match[1]) / 100 : avgRatio;
    });
    // 归一化到总和 1，使子块填满整个超级块（删除/移入后不留空白）
    const totalRatio = ratios.reduce((s, r) => s + r, 0) || 1;
    // 记录改前 style 用于持久化
    const changes: Array<{id: string, oldStyle: string}> = [];
    children.forEach((child, i) => {
        const oldStyle = child.getAttribute("style") || "";
        const pct = Math.round((ratios[i] / totalRatio) * 100 * 10) / 10;
        child.style.width = `calc(${pct}% - ${gapShare}px)`;
        child.style.flex = "none";
        changes.push({id: child.getAttribute("data-node-id"), oldStyle});
    });
    return changes;
};

// 刷新超级块的拖拽手柄并重新分配子块宽度，把变更持久化到 do/undo operations
// 宽度撤销插入到 undoOperations 头部，确保 setAttrs undo 先于 move undo 执行（位置恢复后再还原宽度会错位）
// 已脱离 DOM 的超级块会被跳过（cancelSB 可能已将其删除）
export const refreshSbAndPersistWidth = (sbElement: Element,
                                          doOperations: IOperation[], undoOperations: IOperation[]) => {
    if (!sbElement || !sbElement.parentElement) {
        return;
    }
    refreshSbResize(sbElement);
    const widthChanges = rebalanceSbWidth(sbElement);
    widthChanges.forEach(change => {
        const targetEl = sbElement.querySelector(`[data-node-id="${change.id}"]`);
        if (targetEl) {
            // 折叠标题的子块可能未渲染到 DOM，只持久化 style 可避免用不完整 HTML 覆盖块内容。
            doOperations.push({
                action: "setAttrs",
                id: change.id,
                data: JSON.stringify({style: targetEl.getAttribute("style") || ""})
            });
            undoOperations.splice(0, 0, {
                action: "setAttrs",
                id: change.id,
                data: JSON.stringify({style: change.oldStyle})
            });
        }
    });
};

export const jumpToParent = (protyle: IProtyle, nodeElement: Element, type: "parent" | "next" | "previous") => {
    /// #if !MOBILE
    const previousRange = getEditorRange(nodeElement);
    /// #endif
    fetchPost("/api/block/getBlockSiblingID", {
        id: nodeElement.getAttribute("data-node-id"),
        notebook: protyle.notebookId,
    }, async (response) => {
        const targetId = response.data[type];
        if (!targetId) {
            return;
        }
        const titleElement = protyle.title?.editElement;
        if (shouldFocusParentDocumentTitle({
            isRoot: targetId === protyle.block.rootID,
            hasTitle: Boolean(titleElement),
            isBacklink: Boolean(protyle.options.backlinkData),
        })) {
            /// #if !MOBILE
            let pushBack: typeof import("../util/backForward").pushBack | undefined;
            try {
                ({pushBack} = await import("../util/backForward"));
            } catch (error) {
                console.error("Failed to load the back-forward module", error);
            }
            /// #endif
            const focusTitle = () => {
                const range = titleElement.ownerDocument.createRange();
                range.selectNodeContents(titleElement);
                range.collapse(false);
                focusByRange(range);
                protyle.toolbar.range = range;
                protyle.contentElement.scrollTop = 0;
                /// #if !MOBILE
                pushBack?.(protyle, range, titleElement);
                /// #endif
            };
            /// #if !MOBILE
            pushBack?.(protyle, previousRange);
            /// #endif
            if (protyle.block.showAll) {
                const {zoomOut} = await import("../menus/protyle");
                zoomOut({
                    protyle,
                    id: protyle.block.rootID,
                    callback: focusTitle,
                    reload: true,
                });
            } else {
                focusTitle();
            }
            return;
        }
        fetchPost("/api/block/checkBlockFold", {
            id: targetId,
            notebook: protyle.notebookId,
        }, (foldResponse) => {
            const targetElement = Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${targetId}"]`))
                .find(item => !isInEmbedBlock(item));
            const shouldFocus = shouldFocusJumpTarget({
                isRoot: targetId === protyle.block.rootID,
                showAll: protyle.block.showAll,
                isFolded: foldResponse.data.isFolded,
                isHidden: !targetElement || targetElement.clientHeight === 0,
            });
            const action: TProtyleAction[] = shouldFocus ?
                [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS];
            /// #if !MOBILE
            openFileById({
                app: protyle.app,
                id: targetId,
                action
            });
            /// #else
            openMobileFileById(protyle.app, targetId, action);
            /// #endif
        });
    });
};

export const insertEmptyBlock = async (protyle: IProtyle, position: InsertPosition, target?: string | Element) => {
    const range = getEditorRange(protyle.wysiwyg.element);
    let blockElement: Element;
    if (typeof target === "string") {
        blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${target}"]`);
    } else if (target) {
        blockElement = target;
    } else {
        const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (selectElements.length > 0) {
            if (position === "beforebegin") {
                blockElement = selectElements[0];
            } else {
                blockElement = selectElements[selectElements.length - 1];
            }
            hideElements(["select"], protyle);
        } else {
            blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
            blockElement = getTopAloneElement(blockElement);
            // https://github.com/siyuan-note/siyuan/issues/14720#issuecomment-2840665326
            if (blockElement.classList.contains("list")) {
                blockElement = hasClosestByClassName(range.startContainer, "li") as HTMLElement;
            } else if (blockElement.classList.contains("bq") || blockElement.classList.contains("callout")) {
                blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
            }
        }
    }
    if (!blockElement) {
        return;
    }
    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range);
    protyle.observerLoad?.disconnect();
    let newElement = genEmptyElement(false, true);
    let orderIndex = 1;
    const previousBlockElement = getPreviousBlockSibling(blockElement);
    if (blockElement.getAttribute("data-type") === "NodeListItem") {
        newElement = genListItemElement(blockElement, 0, true) as HTMLDivElement;
        orderIndex = parseInt(blockElement.parentElement.firstElementChild.getAttribute("data-marker"));
    } else if (position === "beforebegin" &&
        previousBlockElement?.getAttribute("data-type") === "NodeHeading" &&
        previousBlockElement.getAttribute("fold") === "1") {
        newElement = genHeadingElement(previousBlockElement, false, true) as HTMLDivElement;
    } else if (position === "afterend" && blockElement &&
        blockElement.getAttribute("data-type") === "NodeHeading" &&
        blockElement.getAttribute("fold") === "1") {
        newElement = genHeadingElement(blockElement, false, true) as HTMLDivElement;
    }

    const parentOldHTML = blockElement.parentElement.outerHTML;
    const newId = newElement.getAttribute("data-node-id");
    blockElement.insertAdjacentElement(position, newElement);
    if (blockElement.getAttribute("data-type") === "NodeListItem" && blockElement.getAttribute("data-subtype") === "o" &&
        !newElement.parentElement.classList.contains("protyle-wysiwyg")) {
        updateListOrder(newElement.parentElement, orderIndex);
        updateTransaction(protyle, newElement.parentElement, parentOldHTML, undoFocusContext);
    } else {
        let doOperations: IOperation[];
        if (position === "beforebegin") {
            doOperations = [{
                action: "insert",
                data: newElement.outerHTML,
                id: newId,
                nextID: blockElement.getAttribute("data-node-id"),
            }];
        } else {
            doOperations = [{
                action: "insert",
                data: newElement.outerHTML,
                id: newId,
                previousID: blockElement.getAttribute("data-node-id"),
            }];
        }
        const undoOperations: IOperation[] = [{
            action: "delete",
            id: newId,
            context: undoFocusContext,
        }];
        if (blockElement.parentElement.classList.contains("sb") &&
            blockElement.parentElement.getAttribute("data-sb-layout") === "col") {
            // 合并到同一个 transaction，避免新超级块 id 在第二个 transaction 中找不到
            const mergeOperations = await turnsIntoOneTransaction({
                protyle,
                selectsElement: position === "afterend" ? [blockElement, blockElement.nextElementSibling] : [blockElement.previousElementSibling, blockElement],
                type: "BlocksMergeSuperBlock",
                level: "row",
                unfocus: true,
                getOperations: true,
                widthSourceElement: blockElement as HTMLElement,
            });
            doOperations.push(...mergeOperations.doOperations);
            undoOperations.splice(0, 0, ...mergeOperations.undoOperations);
        }
        transaction(protyle, doOperations, undoOperations);
    }
    focusByWbr(protyle.wysiwyg.element, range);
    scrollCenter(protyle);
};

export const insertEmptySuperBlockColumn = (protyle: IProtyle, position: "left" | "right", target?: Element) => {
    const range = getEditorRange(protyle.wysiwyg.element);
    let blockElement = target;
    if (!blockElement) {
        const selectElements = protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select");
        if (selectElements.length > 0) {
            blockElement = position === "left" ? selectElements[0] : selectElements[selectElements.length - 1];
        } else {
            blockElement = hasClosestBlock(range.startContainer) as HTMLElement;
        }
    }
    const columnElement = getHorizontalSuperBlockChild(blockElement, protyle.wysiwyg.element);
    if (!columnElement) {
        return false;
    }

    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range);
    hideElements(["select"], protyle);
    const newElement = genEmptyElement(false, true);
    const newID = newElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [{
        action: "insert",
        data: newElement.outerHTML,
        id: newID,
        parentID: columnElement.parentElement.getAttribute("data-node-id"),
        nextID: position === "left" ? columnElement.getAttribute("data-node-id") : undefined,
        previousID: position === "right" ? columnElement.getAttribute("data-node-id") : undefined,
    }];
    const undoOperations: IOperation[] = [{
        action: "delete",
        id: newID,
        context: undoFocusContext,
    }];
    protyle.observerLoad?.disconnect();
    columnElement.insertAdjacentElement(position === "left" ? "beforebegin" : "afterend", newElement);
    refreshSbAndPersistWidth(columnElement.parentElement, doOperations, undoOperations);
    transaction(protyle, doOperations, undoOperations);
    focusByWbr(protyle.wysiwyg.element, range);
    scrollCenter(protyle);
    return true;
};

export const genEmptyBlock = (zwsp = true, wbr = true, string?: string) => {
    let html = "";
    if (zwsp) {
        html = Constants.ZWSP;
    }
    if (wbr) {
        html += "<wbr>";
    }
    if (string) {
        html += string;
    }
    return `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}">${html}</div><div contenteditable="false" class="protyle-attr">${Constants.ZWSP}</div></div>`;
};

export const genEmptyElement = (zwsp = true, wbr = true, id?: string) => {
    const element = document.createElement("div");
    element.setAttribute("data-node-id", id || Lute.NewNodeID());
    element.setAttribute("data-type", "NodeParagraph");
    element.classList.add("p");
    element.innerHTML = `<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}">${zwsp ? Constants.ZWSP : ""}${wbr ? "<wbr>" : ""}</div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    return element;
};

export const genHeadingElement = (headElement: Element, getHTML = false, addWbr = false) => {
    const html = `<div data-subtype="${headElement.getAttribute("data-subtype")}" data-node-id="${Lute.NewNodeID()}" data-type="NodeHeading" class="${headElement.className}"><div contenteditable="true" spellcheck="false">${addWbr ? "<wbr>" : ""}</div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
    if (getHTML) {
        return html;
    } else {
        const tempElement = document.createElement("template");
        tempElement.innerHTML = html;
        return tempElement.content.firstElementChild;
    }
};

export const getLangByType = (type: string) => {
    let lang = type;
    switch (type) {
        case "NodeIFrame":
            lang = "IFrame";
            break;
        case "NodeAttributeView":
            lang = window.siyuan.languages.database;
            break;
        case "NodeThematicBreak":
            lang = window.siyuan.languages.line;
            break;
        case "NodeWidget":
            lang = window.siyuan.languages.widget;
            break;
        case "NodeVideo":
            lang = window.siyuan.languages.video;
            break;
        case "NodeAudio":
            lang = window.siyuan.languages.audio;
            break;
        case "NodeBlockQueryEmbed":
            lang = window.siyuan.languages.blockEmbed;
            break;
    }
    return lang;
};
