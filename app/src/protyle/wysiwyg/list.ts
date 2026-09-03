import {focusByRange, focusByWbr, getEditorRange, getUndoFocusContext} from "../util/selection";
import {transaction, turnsIntoOneTransaction, updateTransaction} from "./transaction";
import {genEmptyBlock} from "../../block/util";
import * as dayjs from "dayjs";
import {Constants} from "../../constants";
import {moveToPrevious, removeBlock} from "./remove";
import {hasClosestByClassName, isBlockElement} from "../util/hasClosest";
import {getEmbedChildOperationContext, getParentBlock, getPreviousBlockSibling} from "./getBlock";
import {setFold} from "../util/blockFold";
import {scrollCenter} from "../../util/highlightById";
import {
    getAppendListContext,
    getFirstListItemElement,
    getFollowingOrderedListMarkerUpdates,
    getLastListItemElement,
    getOrderedListMarkerUpdates,
    getOrderedListMaxStart,
    getPreviousListItemID,
    parseOrderedListStart,
    type TListSubtype
} from "./listContext";
import {fetchSyncPost} from "../../util/fetch";
import {Dialog} from "../../dialog";
import {isMobile} from "../../util/functions";
import {showMessage} from "../../dialog/message";
import {activateTrackedRangeInsertion, type ITrackedRangeInsertion} from "../util/trackedRange";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../asset/html";

const getLastChildBlock = (element: Element) => {
    if (!element || !element.lastElementChild) {
        return null;
    }
    let current = element.lastElementChild.previousElementSibling;
    while (current) {
        if (isBlockElement(current)) {
            return current;
        }
        current = current.previousElementSibling;
    }
    return null;
};

const unfoldElements = (protyle: IProtyle, elements: Element[]) => {
    elements.forEach(item => {
        if (item.getAttribute("fold") === "1") {
            setFold(protyle, item, true, false, false, false, false);
        }
    });
};

export const updateListOrder = (listElement: Element, sIndex?: number) => {
    if (listElement.getAttribute("data-subtype") !== "o") {
        return true;
    }
    const blockChildren = Array.from(listElement.children).filter(item => item.hasAttribute("data-node-id"));
    if (blockChildren.some(item => item.getAttribute("data-type") !== "NodeListItem")) {
        return false;
    }
    const listItemElements = blockChildren as HTMLElement[];
    const markerUpdates = getOrderedListMarkerUpdates(
        listItemElements.map(item => item.getAttribute("data-marker")), sIndex);
    listItemElements.forEach((item, index) => {
        const marker = markerUpdates[index];
        if (marker) {
            item.setAttribute("data-marker", marker);
            const actionElement = item.querySelector(".protyle-action--order");
            if (actionElement) {
                actionElement.textContent = marker;
            }
        }
    });
    return true;
};

const getOrderedListItemElements = (listElement: Element) => Array.from(listElement.children).filter((item) =>
    item.getAttribute("data-type") === "NodeListItem") as HTMLElement[];

export const getOrderedListStart = (listElement: Element) => {
    if (listElement.getAttribute("data-subtype") !== "o") {
        return;
    }
    const start = Number.parseInt(getOrderedListItemElements(listElement)[0]?.getAttribute("data-marker"), 10);
    return Number.isFinite(start) ? Math.trunc(start) : undefined;
};

export const setOrderedListStart = (protyle: IProtyle, listElement: HTMLElement, start: number) => {
    if (listElement.getAttribute("data-type") !== "NodeList" ||
        listElement.getAttribute("data-subtype") !== "o") {
        return false;
    }
    const listItemElements = getOrderedListItemElements(listElement);
    if (parseOrderedListStart(start.toString(), listItemElements.length) === undefined) {
        return false;
    }
    const oldHTML = listElement.outerHTML;
    updateListOrder(listElement, start);
    updateTransaction(protyle, listElement, oldHTML);
    return true;
};

export const openOrderedListStartDialog = (protyle: IProtyle, listElement: HTMLElement, range?: Range) => {
    const listItemElements = getOrderedListItemElements(listElement);
    const maxStart = getOrderedListMaxStart(listItemElements.length);
    if (maxStart === undefined) {
        return;
    }
    const initialStart = Number.parseInt(listItemElements[0].getAttribute("data-marker"), 10);
    const dialog = new Dialog({
        title: window.siyuan.languages.orderedListStart,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" type="number" min="0" max="${maxStart}" step="1"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "360px",
        destroyCallback() {
            if (range?.startContainer?.isConnected) {
                focusByRange(range);
            }
        }
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const buttonElements = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
    inputElement.value = Number.isFinite(initialStart) ? Math.trunc(initialStart).toString() : "1";
    dialog.bindInput(inputElement, () => {
        buttonElements[1].click();
    });
    inputElement.select();
    buttonElements[0].addEventListener("click", () => {
        dialog.destroy();
    });
    buttonElements[1].addEventListener("click", () => {
        const start = parseOrderedListStart(inputElement.value, listItemElements.length);
        if (start === undefined) {
            showMessage(window.siyuan.languages.invalid, 3000, "error");
            inputElement.focus();
            inputElement.select();
            return;
        }
        setOrderedListStart(protyle, listElement, start);
        dialog.destroy();
    });
};

export const toggleTaskListItem = (protyle: IProtyle, taskItemElement: Element): void => {
    const html = taskItemElement.outerHTML;
    const marker = taskItemElement.getAttribute("data-task");
    const useElement = taskItemElement.querySelector("use");
    if (marker !== null && marker !== " ") {
        taskItemElement.setAttribute("data-task", " ");
        taskItemElement.classList.remove("protyle-task--done");
        useElement?.setAttribute("xlink:href", "#iconUncheck");
    } else {
        taskItemElement.setAttribute("data-task", "X");
        taskItemElement.classList.add("protyle-task--done");
        useElement?.setAttribute("xlink:href", "#iconCheck");
    }
    taskItemElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
    taskItemElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
    updateTransaction(protyle, taskItemElement, html);
};

export const genListItemElement = (listItemElement: Element, offset = 0, wbr = false, startIndex?: number) => {
    const element = document.createElement("template");
    const type = listItemElement.getAttribute("data-subtype");
    if (type === "o") {
        const index = startIndex !== undefined ? startIndex : parseInt(listItemElement.getAttribute("data-marker")) + offset + 1;
        element.innerHTML = `<div data-marker="${index}." data-subtype="o" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div contenteditable="false" class="protyle-action protyle-action--order" draggable="true">${index}.</div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    } else if (type === "t") {
        element.innerHTML = `<div data-task=" " data-marker="*" data-subtype="t" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconUncheck"></use></svg></div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    } else {
        element.innerHTML = `<div data-marker="*" data-subtype="u" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div>${genEmptyBlock(false, wbr)}<div class="protyle-attr" contenteditable="false"></div></div>`;
    }
    return element.content.firstElementChild as HTMLElement;
};

const getListElementByID = async (protyle: IProtyle, listID: string) => {
    const response = await fetchSyncPost("/api/block/getBlockDOM", {
        id: listID,
        notebook: protyle.notebookId,
    });
    const template = document.createElement("template");
    template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data?.dom || "");
    const listElement = template.content.firstElementChild as HTMLElement;
    if (listElement?.getAttribute("data-type") !== "NodeList") {
        return;
    }
    return listElement;
};

const isFocusedListItemEditor = (protyle: IProtyle, editorElement: Element) =>
    editorElement.classList.contains("protyle-wysiwyg") &&
    editorElement.getAttribute("data-doc-type") === "NodeListItem" && !!protyle.block.parentID;

export const getFocusedParentOrderedList = async (protyle: IProtyle, editorElement: Element) => {
    if (!isFocusedListItemEditor(protyle, editorElement)) {
        return;
    }
    try {
        const listElement = await getListElementByID(protyle, protyle.block.parentID);
        if (listElement?.getAttribute("data-subtype") === "o") {
            return listElement;
        }
    } catch {
        return;
    }
};

const getDirectListItemByID = (listElement: Element, id: string) => Array.from(listElement.children).find((item) =>
    item.getAttribute("data-type") === "NodeListItem" && item.getAttribute("data-node-id") === id) as
    HTMLElement | undefined;

const appendFocusedListUpdate = (listElement: HTMLElement, oldHTML: string,
                                 doOperations: IOperation[], undoOperations: IOperation[], startIndex?: number) => {
    updateListOrder(listElement, startIndex);
    const id = listElement.getAttribute("data-node-id");
    doOperations.push({
        action: "update",
        id,
        data: listElement.outerHTML,
    });
    undoOperations.push({
        action: "update",
        id,
        data: oldHTML,
    });
};

export const getFocusedOrderedListInsertOperations = (listElement: HTMLElement, listItemElement: HTMLElement,
                                                      newListItemElement: HTMLElement) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    if (listItemElement.getAttribute("data-subtype") !== "o") {
        return {doOperations, undoOperations};
    }
    const currentElement = getDirectListItemByID(listElement,
        listItemElement.getAttribute("data-node-id"));
    if (!currentElement) {
        return {doOperations, undoOperations};
    }
    const oldHTML = listElement.outerHTML;
    const startIndex = getOrderedListStart(listElement);
    currentElement.replaceWith(listItemElement.cloneNode(true));
    const updatedCurrentElement = getDirectListItemByID(listElement,
        listItemElement.getAttribute("data-node-id"));
    if (!updatedCurrentElement) {
        return {doOperations, undoOperations};
    }
    updatedCurrentElement.insertAdjacentElement("afterend", newListItemElement.cloneNode(true) as HTMLElement);
    appendFocusedListUpdate(listElement, oldHTML, doOperations, undoOperations, startIndex);
    return {doOperations, undoOperations};
};

export const getFocusedOrderedListRemoveOperations = (listElement: HTMLElement,
                                                      previousListItemElement: HTMLElement,
                                                      removedListItemID: string) => {
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    if (listElement.getAttribute("data-subtype") !== "o") {
        return {doOperations, undoOperations};
    }
    const previousClone = getDirectListItemByID(listElement,
        previousListItemElement.getAttribute("data-node-id"));
    const removedClone = getDirectListItemByID(listElement, removedListItemID);
    if (!previousClone || !removedClone) {
        return {doOperations, undoOperations};
    }
    const oldHTML = listElement.outerHTML;
    const startIndex = getOrderedListStart(listElement);
    previousClone.replaceWith(previousListItemElement.cloneNode(true));
    removedClone.remove();
    appendFocusedListUpdate(listElement, oldHTML, doOperations, undoOperations, startIndex);
    return {doOperations, undoOperations};
};

export const getFocusedOrderedListDeleteOperations = (listElement: HTMLElement,
                                                      removedListItemElement: HTMLElement) => {
    if (listElement.getAttribute("data-subtype") !== "o" ||
        removedListItemElement.getAttribute("data-subtype") !== "o") {
        return;
    }
    const removedListItemID = removedListItemElement.getAttribute("data-node-id");
    const removedClone = getDirectListItemByID(listElement, removedListItemID);
    if (!removedClone) {
        return;
    }
    const previousID = getPreviousListItemID(listElement, removedListItemID);
    removedClone.replaceWith(removedListItemElement.cloneNode(true));
    const updatedRemovedClone = getDirectListItemByID(listElement, removedListItemID);
    if (!updatedRemovedClone) {
        return;
    }
    const oldHTML = listElement.outerHTML;
    const startIndex = getOrderedListStart(listElement);
    updatedRemovedClone.remove();
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    appendFocusedListUpdate(listElement, oldHTML, doOperations, undoOperations, startIndex);
    return {doOperations, undoOperations, previousID};
};

const appendFocusedIndentListUpdate = (listElement: HTMLElement, previousElement: HTMLElement,
                                       movedElements: Element[], doOperations: IOperation[],
                                       undoOperations: IOperation[]) => {
    const previousID = previousElement.getAttribute("data-node-id");
    const previousClone = getDirectListItemByID(listElement, previousID);
    if (!previousClone) {
        return;
    }
    const oldHTML = listElement.outerHTML;
    const startIndex = getOrderedListStart(listElement);
    previousClone.replaceWith(previousElement.cloneNode(true));
    movedElements.forEach((item) => {
        getDirectListItemByID(listElement, item.getAttribute("data-node-id"))?.remove();
    });
    appendFocusedListUpdate(listElement, oldHTML, doOperations, undoOperations, startIndex);
};

const appendFocusedOutdentListUpdate = (listElement: HTMLElement, parentListItemElement: HTMLElement,
                                        movedElements: HTMLElement[], doOperations: IOperation[],
                                        undoOperations: IOperation[]) => {
    const parentClone = getDirectListItemByID(listElement,
        parentListItemElement.getAttribute("data-node-id"));
    if (!parentClone) {
        return;
    }
    const oldHTML = listElement.outerHTML;
    const startIndex = getOrderedListStart(listElement);
    const referenceElement = parentClone.nextElementSibling;
    if (parentListItemElement.isConnected) {
        parentClone.replaceWith(parentListItemElement.cloneNode(true));
    } else {
        parentClone.remove();
    }
    movedElements.forEach((item) => {
        listElement.insertBefore(item.cloneNode(true), referenceElement);
    });
    updateListOrder(listElement, startIndex);
    movedElements.forEach((item) => {
        const updatedElement = getDirectListItemByID(listElement, item.getAttribute("data-node-id"));
        const marker = updatedElement?.getAttribute("data-marker");
        if (!marker || marker === item.getAttribute("data-marker")) {
            return;
        }
        undoOperations.push({
            action: "update",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
        });
        item.setAttribute("data-marker", marker);
        const actionElement = item.querySelector(".protyle-action--order");
        if (actionElement) {
            actionElement.textContent = marker;
        }
        item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
        doOperations.push({
            action: "update",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
        });
    });
    appendFocusedListUpdate(listElement, oldHTML, doOperations, undoOperations, startIndex);
};

const insertingFocusedListItems = new WeakSet<IProtyle>();

const insertingBoundaryListItems = new WeakSet<IProtyle>();

const getFocusedListElement = (protyle: IProtyle, listID: string) => getListElementByID(protyle, listID);

const getFocusedListTailItem = async (protyle: IProtyle, listID: string, currentListItem?: HTMLElement) => {
    const tailResponse = await fetchSyncPost("/api/block/getTailChildBlocks", {
        id: listID,
        n: 1,
        notebook: protyle.notebookId,
    });
    const tailBlock = tailResponse.data?.[0] as {id?: string, type?: string} | undefined;
    if (!tailBlock?.id || tailBlock.type !== "i") {
        return;
    }
    if (currentListItem?.getAttribute("data-node-id") === tailBlock.id) {
        return currentListItem;
    }

    const domResponse = await fetchSyncPost("/api/block/getBlockDOM", {
        id: tailBlock.id,
        notebook: protyle.notebookId,
    });
    const template = document.createElement("template");
    template.innerHTML = domResponse.data?.dom || "";
    const tailItemElement = template.content.firstElementChild as HTMLElement;
    if (tailItemElement?.getAttribute("data-type") !== "NodeListItem") {
        return;
    }
    return tailItemElement;
};

export const appendListItem = async (protyle: IProtyle, nodeElement: HTMLElement, range?: Range) => {
    if (insertingBoundaryListItems.has(protyle)) {
        return;
    }
    const context = getAppendListContext(nodeElement, protyle.wysiwyg.element);
    if (!context) {
        return;
    }

    insertingBoundaryListItems.add(protyle);
    try {
        let tailItemElement: HTMLElement | undefined;
        if (context.listElement) {
            tailItemElement = getLastListItemElement(context.listElement);
        } else if (protyle.block.parentID) {
            tailItemElement = await getFocusedListTailItem(protyle, protyle.block.parentID,
                context.listItemElement);
        }
        if (!tailItemElement) {
            return;
        }

        const tailID = tailItemElement.getAttribute("data-node-id");
        if (!tailID) {
            return;
        }
        const newListItemElement = genListItemElement(tailItemElement, 0, true);
        const id = newListItemElement.getAttribute("data-node-id");
        const editorRange = range || getEditorRange(protyle.wysiwyg.element);
        const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, editorRange, true);
        const localPreviousElement = context.listElement ? tailItemElement : context.listItemElement;
        if (!localPreviousElement?.isConnected) {
            return;
        }
        localPreviousElement.insertAdjacentElement("afterend", newListItemElement);
        transaction(protyle, [{
            action: "insert",
            id,
            data: newListItemElement.outerHTML,
            previousID: tailID,
        }], [{
            action: "delete",
            id,
            context: undoFocusContext,
        }]);
        focusByWbr(newListItemElement, editorRange);
        scrollCenter(protyle, newListItemElement);
    } finally {
        insertingBoundaryListItems.delete(protyle);
    }
};

export const prependListItem = async (protyle: IProtyle, nodeElement: HTMLElement, range?: Range) => {
    if (insertingBoundaryListItems.has(protyle)) {
        return;
    }
    const context = getAppendListContext(nodeElement, protyle.wysiwyg.element);
    if (!context) {
        return;
    }

    insertingBoundaryListItems.add(protyle);
    try {
        let listElement = context.listElement;
        if (!listElement && protyle.block.parentID) {
            listElement = await getFocusedListElement(protyle, protyle.block.parentID);
        }
        if (!listElement) {
            return;
        }
        const firstListItemElement = getFirstListItemElement(listElement);
        const firstID = firstListItemElement?.getAttribute("data-node-id");
        if (!firstListItemElement || !firstID) {
            return;
        }
        const oldListHTML = listElement.outerHTML;

        let startIndex: number | undefined;
        if (firstListItemElement.getAttribute("data-subtype") === "o") {
            const parsedIndex = Number.parseInt(firstListItemElement.getAttribute("data-marker"), 10);
            startIndex = Number.isFinite(parsedIndex) ? Math.trunc(parsedIndex) : 1;
        }
        const newListItemElement = genListItemElement(firstListItemElement, 0, true, startIndex);
        const id = newListItemElement.getAttribute("data-node-id");
        const doOperations: IOperation[] = [{
            action: "insert",
            id,
            data: newListItemElement.outerHTML,
            nextID: firstID,
        }];
        const undoOperations: IOperation[] = [];
        if (startIndex !== undefined) {
            const listItemElements = Array.from(listElement.children).filter((item) =>
                item.getAttribute("data-type") === "NodeListItem") as HTMLElement[];
            const markerUpdates = getFollowingOrderedListMarkerUpdates(
                newListItemElement.getAttribute("data-marker"),
                listItemElements.map((item) => item.getAttribute("data-marker")));
            listItemElements.forEach((item, index) => {
                const marker = markerUpdates[index];
                if (!marker) {
                    return;
                }
                const itemID = item.getAttribute("data-node-id");
                if (context.listElement) {
                    undoOperations.push({
                        action: "update",
                        id: itemID,
                        data: item.outerHTML,
                    });
                }
                item.setAttribute("data-marker", marker);
                const actionElement = item.querySelector(".protyle-action--order");
                if (actionElement) {
                    actionElement.textContent = marker;
                }
                if (context.listElement) {
                    doOperations.push({
                        action: "update",
                        id: itemID,
                        data: item.outerHTML,
                    });
                }
            });
            if (!context.listElement) {
                firstListItemElement.insertAdjacentElement("beforebegin",
                    newListItemElement.cloneNode(true) as HTMLElement);
                appendFocusedListUpdate(listElement, oldListHTML, doOperations, undoOperations, startIndex);
            }
        }

        const editorRange = range || getEditorRange(protyle.wysiwyg.element);
        const localNextElement = context.listElement ? firstListItemElement : context.listItemElement;
        if (!localNextElement?.isConnected) {
            return;
        }
        if (!context.listElement && startIndex !== undefined) {
            const currentItemElement = Array.from(listElement.children).find((item) =>
                item.getAttribute("data-node-id") === context.listItemElement?.getAttribute("data-node-id"));
            const marker = currentItemElement?.getAttribute("data-marker");
            if (marker) {
                context.listItemElement.setAttribute("data-marker", marker);
                const actionElement = context.listItemElement.querySelector(".protyle-action--order");
                if (actionElement) {
                    actionElement.textContent = marker;
                }
            }
        }
        localNextElement.insertAdjacentElement("beforebegin", newListItemElement);
        undoOperations.unshift({
            action: "delete",
            id,
            context: getUndoFocusContext(protyle.wysiwyg.element, editorRange, true),
        });
        transaction(protyle, doOperations, undoOperations);
        focusByWbr(newListItemElement, editorRange);
        scrollCenter(protyle, newListItemElement);
    } finally {
        insertingBoundaryListItems.delete(protyle);
    }
};

export const insertEmptyListItem = async (protyle: IProtyle, listItemElement: HTMLElement, range: Range) => {
    const listElement = listItemElement.parentElement;
    if (!listElement) {
        return;
    }

    const newListItemElement = genListItemElement(listItemElement, 0, true);
    const id = newListItemElement.getAttribute("data-node-id");
    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
    if (listElement.classList.contains("protyle-wysiwyg")) {
        if (insertingFocusedListItems.has(protyle)) {
            return;
        }
        insertingFocusedListItems.add(protyle);
        try {
            const shouldUpdateParentList = listItemElement.getAttribute("data-subtype") === "o";
            const parentListElement = shouldUpdateParentList ?
                await getFocusedParentOrderedList(protyle, listElement) : undefined;
            if (shouldUpdateParentList && !parentListElement) {
                return;
            }
            const orderOperations = parentListElement ?
                getFocusedOrderedListInsertOperations(parentListElement, listItemElement, newListItemElement) :
                {doOperations: [], undoOperations: []};
            if (!listItemElement.isConnected) {
                return;
            }
            listItemElement.insertAdjacentElement("afterend", newListItemElement);
            transaction(protyle, [{
                action: "insert",
                id,
                data: newListItemElement.outerHTML,
                previousID: listItemElement.getAttribute("data-node-id"),
            }, ...orderOperations.doOperations], [{
                action: "delete",
                id,
                context: undoFocusContext,
            }, ...orderOperations.undoOperations]);
            focusByWbr(newListItemElement, range);
            scrollCenter(protyle, newListItemElement);
        } finally {
            insertingFocusedListItems.delete(protyle);
        }
        return;
    }

    const oldHTML = listElement.outerHTML;
    listItemElement.insertAdjacentElement("afterend", newListItemElement);
    updateListOrder(listElement);
    updateTransaction(protyle, listElement, oldHTML, undoFocusContext);
    focusByWbr(newListItemElement, range);
    scrollCenter(protyle, newListItemElement);
};

export const insertEmptyChildList = (protyle: IProtyle, previousElement: HTMLElement,
                                     subtype: TListSubtype, range: Range) => {
    const parentElement = previousElement.parentElement;
    if (!parentElement) {
        return;
    }
    const marker = subtype === "t" ? "- [ ] " : (subtype === "u" ? "- " : "1. ");
    const template = document.createElement("template");
    template.innerHTML = protyle.lute.SpinBlockDOM(marker + Lute.Caret);
    const listElement = template.content.firstElementChild as HTMLElement;
    if (!listElement || listElement.getAttribute("data-type") !== "NodeList" ||
        listElement.getAttribute("data-subtype") !== subtype) {
        return;
    }

    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
    const id = listElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [{
        action: "insert",
        id,
        data: listElement.outerHTML,
        previousID: previousElement.getAttribute("data-node-id"),
        parentID: parentElement.getAttribute("data-node-id"),
    }];
    const undoOperations: IOperation[] = [{
        action: "delete",
        id,
        context: undoFocusContext,
    }];
    [previousElement, parentElement].forEach((item) => {
        if (item.getAttribute("fold") !== "1") {
            return;
        }
        const foldData = setFold(protyle, item, true, false, false, true);
        if (foldData?.doOperations?.length > 0) {
            doOperations.push(...foldData.doOperations);
            undoOperations.push(...foldData.undoOperations);
        }
    });

    previousElement.insertAdjacentElement("afterend", listElement);
    transaction(protyle, doOperations, undoOperations);
    focusByWbr(listElement, range);
    scrollCenter(protyle, listElement);
};

export const addSubList = (protyle: IProtyle, nodeElement: Element, range: Range) => {
    const parentItemElement = hasClosestByClassName(nodeElement, "li");
    if (!parentItemElement) {
        return false;
    }
    const subListElement = parentItemElement.querySelector(".list");
    // 无列表块：在列表项块的最后一个子块后面插入新的列表块
    if (!subListElement) {
        const lastElement = getLastChildBlock(parentItemElement);
        if (!lastElement) {
            return false;
        }
        const id = Lute.NewNodeID();
        const newListItemElement = genListItemElement(parentItemElement, 0, true, 1);
        const newListHTML = `<div data-subtype="${parentItemElement.getAttribute("data-subtype")}" data-node-id="${id}" data-type="NodeList" class="list" updated="${dayjs().format("YYYYMMDDHHmmss")}">${newListItemElement.outerHTML}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
        lastElement.insertAdjacentHTML("afterend", newListHTML);
        unfoldElements(protyle, [parentItemElement]);
        transaction(protyle, [{
            action: "insert",
            id,
            data: newListHTML,
            previousID: lastElement.getAttribute("data-node-id"),
        }], [{
            action: "delete",
            id,
        }]);
        focusByWbr(lastElement.nextElementSibling, range);
        scrollCenter(protyle, lastElement.nextElementSibling);
        return true;
    }

    // 有列表块：在列表块的最后一个列表项块后插入新的列表项块
    const lastSubItem = getLastChildBlock(subListElement);
    if (!lastSubItem) {
        return false;
    }
    const newListElement = genListItemElement(lastSubItem, 0, true);
    const id = newListElement.getAttribute("data-node-id");
    lastSubItem.after(newListElement);
    unfoldElements(protyle, [lastSubItem.parentElement, parentItemElement]);
    transaction(protyle, [{
        action: "insert",
        id,
        data: newListElement.outerHTML,
        previousID: lastSubItem.getAttribute("data-node-id"),
    }], [{
        action: "delete",
        id,
    }]);
    focusByWbr(newListElement, range);
    scrollCenter(protyle, newListElement);
    return true;
};

export const listIndent = async (protyle: IProtyle, liItemElements: Element[], range: Range) => {
    liItemElements.forEach(item => {
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
    });
    if (!liItemElements[0].classList.contains("li")) {
        if (liItemElements[0].parentElement.childElementCount === liItemElements.length + 2) {
            liItemElements = [liItemElements[0].parentElement];
        } else {
            return;
        }
    }
    const listElement = liItemElements[0].parentElement;
    const previousElement = liItemElements[0].previousElementSibling as HTMLElement;
    if (!listElement || !previousElement) {
        return;
    }
    const shouldUpdateParentList = isFocusedListItemEditor(protyle, listElement) &&
        liItemElements[0].getAttribute("data-subtype") === "o";
    const focusedParentListElement = shouldUpdateParentList ?
        await getFocusedParentOrderedList(protyle, listElement) : undefined;
    if (shouldUpdateParentList && !focusedParentListElement) {
        return;
    }
    if (!previousElement.isConnected || liItemElements.some((item) => !item.isConnected)) {
        return;
    }
    range.collapse(false);
    range.insertNode(document.createElement("wbr"));
    const html = listElement.outerHTML;
    const lastPreviousElement = getLastChildBlock(previousElement);
    if (lastPreviousElement && lastPreviousElement.getAttribute("data-type") === "NodeList") {
        // 上一个列表的最后一项为子列表
        const previousLastListHTML = lastPreviousElement.outerHTML;

        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];

        const subtype = lastPreviousElement.getAttribute("data-subtype");
        let previousID = getLastChildBlock(lastPreviousElement)?.getAttribute("data-node-id");
        liItemElements.forEach((item, index) => {
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID
            });
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: index === 0 ? previousElement.getAttribute("data-node-id") : previousID,
            });
            previousID = item.getAttribute("data-node-id");
            if (item.getAttribute("data-subtype") === subtype) {
                lastPreviousElement.lastElementChild.before(item);
                return;
            }
            item.setAttribute("data-subtype", subtype);
            const actionElement = item.querySelector(".protyle-action");
            if (subtype === "o") {
                item.removeAttribute("data-task");
                actionElement.classList.add("protyle-action--order");
                actionElement.classList.remove("protyle-action--task");
                lastPreviousElement.lastElementChild.before(item);
            } else if (subtype === "t") {
                item.setAttribute("data-marker", "*");
                item.setAttribute("data-task", " ");
                actionElement.innerHTML = `<svg><use xlink:href="#icon${item.classList.contains("protyle-task--done") ? "Check" : "Uncheck"}"></use></svg>`;
                actionElement.classList.remove("protyle-action--order");
                actionElement.classList.add("protyle-action--task");
                lastPreviousElement.lastElementChild.before(item);
            } else {
                item.removeAttribute("data-task");
                item.setAttribute("data-marker", "*");
                actionElement.innerHTML = '<svg><use xlink:href="#iconDot"></use></svg>';
                actionElement.classList.remove("protyle-action--order", "protyle-action--task");
                lastPreviousElement.lastElementChild.before(item);
            }
        });

        if (subtype === "o") {
            updateListOrder(lastPreviousElement);
            updateListOrder(listElement);
        } else if (previousElement.getAttribute("data-subtype") === "o") {
            updateListOrder(listElement);
        }

        if (listElement.classList.contains("protyle-wysiwyg")) {
            const newLastPreviousElement = getLastChildBlock(previousElement);
            doOperations.push({
                action: "update",
                data: newLastPreviousElement.outerHTML,
                id: newLastPreviousElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "update",
                data: previousLastListHTML,
                id: newLastPreviousElement.getAttribute("data-node-id")
            });
            if (focusedParentListElement) {
                appendFocusedIndentListUpdate(focusedParentListElement, previousElement as HTMLElement,
                    liItemElements, doOperations, undoOperations);
            }
            newLastPreviousElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            transaction(protyle, doOperations, undoOperations);
        }
    } else {
        const previousHTML = previousElement.outerHTML;
        const subType = liItemElements[0].getAttribute("data-subtype");
        const newListElement = document.createElement("div");
        const newListId = Lute.NewNodeID();
        newListElement.setAttribute("data-node-id", newListId);
        newListElement.setAttribute("data-type", "NodeList");
        newListElement.setAttribute("class", "list");
        newListElement.setAttribute("data-subtype", subType);
        newListElement.innerHTML = '<div class="protyle-attr" contenteditable="false"></div>';
        let foldElement: Element;
        if (lastPreviousElement?.getAttribute("fold") === "1" &&
            lastPreviousElement?.getAttribute("data-type") === "NodeHeading") {
            foldElement = lastPreviousElement;
        }
        const doOperations: IOperation[] = [{
            action: "insert",
            context: {ignoreProcess: foldElement ? "true" : "false"},
            data: newListElement.outerHTML,
            id: newListId,
            previousID: lastPreviousElement?.getAttribute("data-node-id")
        }];
        if (!foldElement) {
            previousElement.lastElementChild.before(newListElement);
        }
        const undoOperations: IOperation[] = [];
        let previousID: string;
        liItemElements.forEach((item, index) => {
            doOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                parentID: newListId,
                previousID
            });
            undoOperations.push({
                action: "move",
                id: item.getAttribute("data-node-id"),
                previousID: index === 0 ? previousElement.getAttribute("data-node-id") : previousID,
            });
            previousID = item.getAttribute("data-node-id");
            newListElement.lastElementChild.before(item);
        });
        undoOperations.push({
            action: "delete",
            id: newListId
        });
        if (foldElement) {
            if (previousElement.getAttribute("data-subtype") === "o") {
                let nextElement = previousElement.nextElementSibling;
                while (nextElement && !nextElement.classList.contains("protyle-attr")) {
                    const nextId = nextElement.getAttribute("data-node-id");
                    undoOperations.push({
                        action: "update",
                        id: nextId,
                        data: nextElement.outerHTML
                    });
                    const count = parseInt(nextElement.getAttribute("data-marker")) - 1 + ".";
                    nextElement.setAttribute("data-marker", count);
                    nextElement.querySelector(".protyle-action--order").textContent = count;
                    doOperations.push({
                        action: "update",
                        id: nextId,
                        data: nextElement.outerHTML
                    });
                    nextElement = nextElement.nextElementSibling;
                }

                Array.from(newListElement.children).forEach((item, index) => {
                    if (item.classList.contains("protyle-attr")) {
                        return;
                    }
                    const itemId = item.getAttribute("data-node-id");
                    undoOperations.push({
                        action: "update",
                        id: itemId,
                        data: item.outerHTML
                    });
                    const count = index + 1 + ".";
                    item.setAttribute("data-marker", count);
                    item.querySelector(".protyle-action--order").textContent = count;
                    item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                    doOperations.push({
                        action: "update",
                        id: itemId,
                        data: item.outerHTML
                    });
                });
            }
            const foldOperations = setFold(protyle, foldElement, true, false, false, true);
            doOperations.push(...foldOperations.doOperations);
            undoOperations.push(...foldOperations.undoOperations);
            if (focusedParentListElement) {
                appendFocusedIndentListUpdate(focusedParentListElement, previousElement as HTMLElement,
                    liItemElements, doOperations, undoOperations);
            }
            transaction(protyle, doOperations, undoOperations);
            focusByWbr(protyle.wysiwyg.element, range);
            return;
        }
        if (subType === "o") {
            updateListOrder(newListElement, 1);
            updateListOrder(listElement);
        }
        if (listElement.classList.contains("protyle-wysiwyg")) {
            doOperations.push({
                action: "update",
                data: previousElement.outerHTML,
                id: previousElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "update",
                data: previousHTML,
                id: previousElement.getAttribute("data-node-id")
            });
            if (focusedParentListElement) {
                appendFocusedIndentListUpdate(focusedParentListElement, previousElement as HTMLElement,
                    liItemElements, doOperations, undoOperations);
            }
            previousElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            transaction(protyle, doOperations, undoOperations);
        }
    }
    if (!listElement.classList.contains("protyle-wysiwyg")) {
        updateTransaction(protyle, listElement, html);
    }
    focusByWbr(protyle.wysiwyg.element, range);
};

export const breakList = async (protyle: IProtyle, blockElement: Element, range: Range,
                                trackedRangeInsertion?: ITrackedRangeInsertion) => {
    const listItemElement = blockElement.parentElement;
    if (!listItemElement.previousElementSibling) {
        await removeBlock(protyle, blockElement, range, "Backspace");
        return;
    }
    const listElement = listItemElement.parentElement;
    const parentElement = listElement.parentElement;
    const isHorizontalSuperBlock = parentElement.classList.contains("sb") &&
        parentElement.getAttribute("data-sb-layout") === "col";
    const listItemId = listItemElement.getAttribute("data-node-id");
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];

    activateTrackedRangeInsertion(trackedRangeInsertion);
    range.insertNode(document.createElement("wbr"));
    const newListId = Lute.NewNodeID();
    let newListHTML = "";
    let hasFind = 0;
    Array.from(listElement.children).forEach(item => {
        if (!hasFind && item === listItemElement) {
            hasFind = 1;
        } else if (hasFind && !item.classList.contains("protyle-attr")) {
            undoOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                previousID: listItemId,
            });
            doOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "delete",
            });
            if (item.getAttribute("data-subtype") === "o") {
                undoOperations.push({
                    id: item.getAttribute("data-node-id"),
                    action: "update",
                    data: item.outerHTML,
                });
                item.setAttribute("data-marker", hasFind + ".");
                item.firstElementChild.innerHTML = hasFind + ".";
            }
            newListHTML += item.outerHTML;
            item.remove();
            hasFind++;
        }
    });
    undoOperations.reverse();
    newListHTML = `<div data-subtype="${listItemElement.getAttribute("data-subtype")}" data-node-id="${newListId}" data-type="NodeList" class="list" updated="${dayjs().format("YYYYMMDDHHmmss")}">${newListHTML}<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
    listElement.insertAdjacentHTML("afterend", newListHTML);
    const newListElement = listElement.nextElementSibling as HTMLElement;
    doOperations.push({
        id: newListId,
        action: "insert",
        previousID: listElement.getAttribute("data-node-id"),
        data: newListHTML
    });
    undoOperations.push({
        id: newListId,
        action: "delete"
    });

    const movedBlockElements: Element[] = [];
    Array.from(listItemElement.children).reverse().forEach((item, index) => {
        if (!item.classList.contains("protyle-action") && !item.classList.contains("protyle-attr")) {
            doOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                previousID: listElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                id: item.getAttribute("data-node-id"),
                action: "move",
                parentID: listItemId,
                data: index === listItemElement.childElementCount - 2 ? "focus" : null
            });
            listElement.after(item);
            movedBlockElements.unshift(item);
        }
    });

    const parentId = listElement.getAttribute("data-node-id");
    const listRemoved = listElement.childElementCount === 2;
    if (listRemoved) {
        undoOperations.splice(0, 0, {
            id: parentId,
            action: "insert",
            data: listElement.outerHTML,
            previousID: getPreviousBlockSibling(listElement)?.getAttribute("data-node-id"),
            parentID: getParentBlock(listElement).getAttribute("data-node-id") || protyle.block.rootID
        });
        listElement.remove();
        doOperations.push({
            id: parentId,
            action: "delete",
        });
    } else {
        undoOperations.splice(0, 0, {
            id: listItemId,
            action: "insert",
            data: listItemElement.outerHTML,
            previousID: getPreviousBlockSibling(listItemElement)?.getAttribute("data-node-id"),
            parentID: parentId
        });
        listItemElement.remove();
        doOperations.push({
            id: listItemId,
            action: "delete",
        });
    }

    if (isHorizontalSuperBlock) {
        const selectsElement = listRemoved ?
            [...movedBlockElements, newListElement] : [listElement, ...movedBlockElements, newListElement];
        const mergeOperations = await turnsIntoOneTransaction({
            protyle,
            selectsElement,
            type: "BlocksMergeSuperBlock",
            level: "row",
            unfocus: true,
            getOperations: true,
            widthSourceElement: listElement,
        });
        doOperations.push(...mergeOperations.doOperations);
        undoOperations.splice(0, 0, ...mergeOperations.undoOperations);
    }
    transaction(protyle, doOperations, undoOperations, {trackedRangeInsertion});
    focusByWbr(protyle.wysiwyg.element, range);
};

/**
 * 反向缩进列表
 * @param protyle
 * @param liItemElements
 * @param range
 * @param isDelete
 * @param deleteElement 末尾反向删除时才会传入
 */
export const listOutdent = async (protyle: IProtyle, liItemElements: Element[], range: Range, isDelete = false,
                                  deleteElement?: Element, trackedRangeInsertion?: ITrackedRangeInsertion) => {
    if (!liItemElements[0].classList.contains("li")) {
        if (liItemElements[0].parentElement.childElementCount === liItemElements.length + 2) {
            liItemElements = [liItemElements[0].parentElement];
        } else {
            return;
        }
    }
    const liElement = liItemElements[0].parentElement;
    const liId = liElement.getAttribute("data-node-id");
    if (!liId) {
        // zoom in 列表项
        return;
    }
    const parentLiItemElement = getParentBlock(liElement);
    const parentParentElement = parentLiItemElement.parentElement;
    const embedContext = getEmbedChildOperationContext(liElement);
    if (embedContext?.targetElement === parentLiItemElement ||
        (embedContext && !embedContext.boundaryElement.contains(parentLiItemElement)) ||
        (!embedContext && (parentLiItemElement.classList.contains("protyle-wysiwyg__embed") ||
            parentParentElement.classList.contains("protyle-wysiwyg__embed")))) {
        return;
    }
    if (liElement.previousElementSibling?.classList.contains("protyle-action") && !parentParentElement.getAttribute("data-node-id")) {
        // https://ld246.com/article/1691981936960 情况下 zoom in 列表项
        return;
    }
    const shouldUpdateParentList = isFocusedListItemEditor(protyle, parentParentElement) &&
        parentLiItemElement.getAttribute("data-subtype") === "o";
    const focusedParentListElement = shouldUpdateParentList ?
        await getFocusedParentOrderedList(protyle, parentParentElement) : undefined;
    if (shouldUpdateParentList && !focusedParentListElement) {
        return;
    }
    if (!liElement.isConnected || !parentLiItemElement.isConnected ||
        liItemElements.some((item) => !item.isConnected)) {
        return;
    }
    activateTrackedRangeInsertion(trackedRangeInsertion);
    liItemElements.forEach(item => {
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
    });
    const movedListItemElements = [...liItemElements] as HTMLElement[];
    if (parentLiItemElement.classList.contains("protyle-wysiwyg") || parentLiItemElement.classList.contains("sb") ||
        parentLiItemElement.classList.contains("bq") || parentLiItemElement.classList.contains("callout")) {
        // 顶层列表
        const topDoOperations: IOperation[] = [];
        const topUndoOperations: IOperation[] = [];
        range.collapse(false);
        moveToPrevious(deleteElement, range, isDelete);
        range.insertNode(document.createElement("wbr"));
        let startIndex;
        if (!liItemElements[0].previousElementSibling && liElement.getAttribute("data-subtype") === "o") {
            startIndex = parseInt(liItemElements[0].getAttribute("data-marker"));
        }
        let topPreviousID = liId;
        let previousElement: Element = liElement;
        const movedBlockElements: Element[] = [];
        let nextElement = liItemElements[liItemElements.length - 1].nextElementSibling;
        let lastBlockElement = getLastChildBlock(liItemElements[liItemElements.length - 1]);
        liItemElements.forEach(item => {
            Array.from(item.children).forEach((blockElement, index) => {
                const id = blockElement.getAttribute("data-node-id");
                if (!id) {
                    return;
                }
                topDoOperations.push({
                    action: "move",
                    id,
                    previousID: topPreviousID,
                    parentID: parentLiItemElement.getAttribute("data-node-id") || protyle.block.parentID
                });
                topUndoOperations.push({
                    action: "move",
                    id,
                    previousID: index === 1 ? undefined : topPreviousID,
                    parentID: item.getAttribute("data-node-id"),
                    data: blockElement.contains(range.startContainer) ? "focus" : "" // 标记需要 focus，https://ld246.com/article/1650018446988/comment/1650081404993?r=Vanessa#comments
                });
                topPreviousID = id;
                previousElement.after(blockElement);
                previousElement = blockElement;
                movedBlockElements.push(blockElement);
            });
        });
        if (!window.siyuan.config.editor.listLogicalOutdent && !nextElement.classList.contains("protyle-attr")) {
            // 传统缩进
            let newId;
            if (!lastBlockElement || lastBlockElement.getAttribute("data-subtype") !== nextElement.getAttribute("data-subtype")) {
                newId = Lute.NewNodeID();
                lastBlockElement = document.createElement("div");
                lastBlockElement.classList.add("list");
                lastBlockElement.setAttribute("data-subtype", nextElement.getAttribute("data-subtype"));
                lastBlockElement.setAttribute("data-node-id", newId);
                lastBlockElement.setAttribute("data-type", "NodeList");
                lastBlockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                lastBlockElement.innerHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
                previousElement.after(lastBlockElement);
                movedBlockElements.push(lastBlockElement);
                topDoOperations.push({
                    action: "insert",
                    id: newId,
                    data: lastBlockElement.outerHTML,
                    previousID: previousElement.getAttribute("data-node-id"),
                });
            }
            let topOldPreviousID;
            while (nextElement && !nextElement.classList.contains("protyle-attr")) {
                topDoOperations.push({
                    action: "move",
                    id: nextElement.getAttribute("data-node-id"),
                    previousID: topOldPreviousID || getLastChildBlock(lastBlockElement)?.getAttribute("data-node-id"),
                    parentID: lastBlockElement.getAttribute("data-node-id")
                });
                topUndoOperations.push({
                    action: "move",
                    id: nextElement.getAttribute("data-node-id"),
                    parentID: lastBlockElement.getAttribute("data-node-id"),
                    previousID: topOldPreviousID || getPreviousBlockSibling(nextElement)?.getAttribute("data-node-id"),
                });
                topOldPreviousID = nextElement.getAttribute("data-node-id");
                const tempElement = nextElement;
                nextElement = nextElement.nextElementSibling;
                lastBlockElement.lastElementChild.before(tempElement);
            }
            if (lastBlockElement.getAttribute("data-subtype") === "o") {
                Array.from(lastBlockElement.children).forEach(orderItem => {
                    const id = orderItem.getAttribute("data-node-id");
                    if (id) {
                        topUndoOperations.push({
                            action: "update",
                            id,
                            data: orderItem.outerHTML,
                        });
                    }
                });
                updateListOrder(lastBlockElement, 1);
                Array.from(lastBlockElement.children).forEach(orderItem => {
                    const id = orderItem.getAttribute("data-node-id");
                    if (id) {
                        topDoOperations.push({
                            action: "update",
                            id,
                            data: orderItem.outerHTML,
                        });
                    }
                });
            }
            if (newId) {
                topUndoOperations.push({
                    action: "delete",
                    id: newId
                });
            }
        }
        const movedHTML = liElement.outerHTML;
        liItemElements.forEach(item => {
            item.remove();
        });

        const listRemoved = liElement.childElementCount === 1;
        if (listRemoved) {
            // 列表只有一项
            topDoOperations.push({
                action: "delete",
                id: liId
            });
            // 聚焦列表，第一个列表项反向缩进后刷新会关闭页签
            if (liId === protyle.block.id) {
                protyle.block.id = protyle.block.parentID;
            }
            topUndoOperations.splice(0, 0, {
                action: "insert",
                data: movedHTML,
                id: liId,
                previousID: getPreviousBlockSibling(liElement)?.getAttribute("data-node-id"),
                parentID: parentLiItemElement.getAttribute("data-node-id") || protyle.block.parentID
            });
            liElement.remove();
        } else {
            if (liElement.getAttribute("data-subtype") === "o") {
                updateListOrder(liElement, startIndex);
            }
            topDoOperations.push({
                action: "update",
                id: liId,
                data: liElement.outerHTML
            });
            topUndoOperations.splice(0, 0, {
                action: "update",
                id: liId,
                data: movedHTML,
            });
        }
        if (parentLiItemElement.classList.contains("sb") &&
            parentLiItemElement.getAttribute("data-sb-layout") === "col") {
            const selectsElement = listRemoved ? movedBlockElements : [liElement, ...movedBlockElements];
            if (selectsElement.length > 1) {
                // 合并到同一个 transaction，避免新超级块 id 在第二个 transaction 中找不到
                const mergeOperations = await turnsIntoOneTransaction({
                    protyle,
                    selectsElement,
                    type: "BlocksMergeSuperBlock",
                    level: "row",
                    unfocus: true,
                    getOperations: true,
                    widthSourceElement: liElement,
                });
                topDoOperations.push(...mergeOperations.doOperations);
                topUndoOperations.splice(0, 0, ...mergeOperations.undoOperations);
            } else if (listRemoved && selectsElement.length === 1 && liElement.style.width) {
                const targetElement = selectsElement[0] as HTMLElement;
                const oldStyle = targetElement.getAttribute("style") || "";
                targetElement.style.width = liElement.style.width;
                targetElement.style.flex = liElement.style.flex;
                topDoOperations.push({
                    action: "setAttrs",
                    id: targetElement.getAttribute("data-node-id"),
                    data: JSON.stringify({style: targetElement.getAttribute("style") || ""})
                });
                topUndoOperations.splice(0, 0, {
                    action: "setAttrs",
                    id: targetElement.getAttribute("data-node-id"),
                    data: JSON.stringify({style: oldStyle})
                });
            }
        }
        transaction(protyle, topDoOperations, topUndoOperations, {trackedRangeInsertion});
        focusByWbr(parentLiItemElement, range);
        return;
    }

    if (liElement.childElementCount === 2 &&
        (parentLiItemElement.childElementCount === 3 ||
            (window.siyuan.config.editor.listLogicalOutdent &&
                liElement.previousElementSibling?.classList.contains("protyle-action")))) {
        // 父列表项仅包含单项子列表，或开启大纲反向缩进且单项子列表为首个内容块时，原地展开子列表
        range.collapse(false);
        moveToPrevious(deleteElement, range, isDelete);
        range.insertNode(document.createElement("wbr"));
        const html = parentLiItemElement.outerHTML;
        liItemElements[0].firstElementChild.remove();
        liItemElements[0].lastElementChild.remove();
        liElement.outerHTML = liItemElements[0].innerHTML;
        updateTransaction(protyle, parentLiItemElement, html, undefined, undefined, {trackedRangeInsertion});
        focusByWbr(parentLiItemElement, range);
        return;
    }

    range.collapse(false);
    moveToPrevious(deleteElement, range, isDelete);
    range.insertNode(document.createElement("wbr"));
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    const previousID = getPreviousBlockSibling(liItemElements[0])?.getAttribute("data-node-id");
    let startIndex;
    if (!liItemElements[0].previousElementSibling && liElement.getAttribute("data-subtype") === "o") {
        startIndex = parseInt(liItemElements[0].getAttribute("data-marker"));
    }
    const html = parentLiItemElement.parentElement.outerHTML;
    let nextElement = liItemElements[liItemElements.length - 1].nextElementSibling;
    let lastBlockElement = getLastChildBlock(liItemElements[liItemElements.length - 1]);
    liItemElements.reverse().forEach(item => {
        const itemId = item.getAttribute("data-node-id");
        doOperations.push({
            action: "move",
            id: itemId,
            previousID: parentLiItemElement.getAttribute("data-node-id")
        });
        undoOperations.push({
            action: "move",
            id: itemId,
            previousID,
            parentID: liElement.getAttribute("data-node-id")
        });
        parentLiItemElement.after(item);
        if ((item.getAttribute("data-subtype") === "o" || item.getAttribute("data-subtype") === "t") &&
            parentLiItemElement.getAttribute("data-subtype") === "u") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div>';
            item.setAttribute("data-subtype", "u");
            item.setAttribute("data-marker", "*");
            item.removeAttribute("data-task");
            item.classList.remove("protyle-task--done");
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        } else if ((item.getAttribute("data-subtype") === "u" || item.getAttribute("data-subtype") === "t") &&
            parentLiItemElement.getAttribute("data-subtype") === "o") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div contenteditable="false" draggable="true" class="protyle-action protyle-action--order">1.</div>';
            item.setAttribute("data-subtype", "o");
            item.setAttribute("data-marker", "1.");
            item.removeAttribute("data-task");
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        } else if ((item.getAttribute("data-subtype") === "u" || item.getAttribute("data-subtype") === "o") &&
            parentLiItemElement.getAttribute("data-subtype") === "t") {
            undoOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
            item.querySelector(".protyle-action").outerHTML = '<div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconUncheck"></use></svg></div>';
            item.setAttribute("data-subtype", "t");
            item.setAttribute("data-marker", "*");
            item.setAttribute("data-task", " ");
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperations.push({
                action: "update",
                id: itemId,
                data: item.outerHTML
            });
        }
    });
    if (!window.siyuan.config.editor.listLogicalOutdent && !nextElement.classList.contains("protyle-attr")) {
        // 传统缩进
        let newId;
        if (!lastBlockElement || !lastBlockElement.classList.contains("list")) {
            newId = Lute.NewNodeID();
            lastBlockElement = document.createElement("div");
            lastBlockElement.classList.add("list");
            lastBlockElement.setAttribute("data-subtype", nextElement.getAttribute("data-subtype"));
            lastBlockElement.setAttribute("data-node-id", newId);
            lastBlockElement.setAttribute("data-type", "NodeList");
            lastBlockElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            lastBlockElement.innerHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
            doOperations.push({
                action: "insert",
                id: newId,
                data: lastBlockElement.outerHTML,
                previousID: getLastChildBlock(liItemElements[0])?.getAttribute("data-node-id"),
            });
            liItemElements[0].lastElementChild.before(lastBlockElement);
        }
        let subPreviousID;
        while (nextElement && !nextElement.classList.contains("protyle-attr")) {
            const nextId = nextElement.getAttribute("data-node-id");
            if (nextElement.getAttribute("data-subtype") !== lastBlockElement.getAttribute("data-subtype")) {
                undoOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
                nextElement.querySelector(".protyle-action").outerHTML = lastBlockElement.querySelector(".protyle-action").outerHTML;
                nextElement.setAttribute("data-subtype", lastBlockElement.getAttribute("data-subtype"));
                nextElement.setAttribute("data-marker", lastBlockElement.getAttribute("data-marker"));
                if (lastBlockElement.hasAttribute("data-task")) {
                    nextElement.setAttribute("data-task", lastBlockElement.getAttribute("data-task"));
                } else {
                    nextElement.removeAttribute("data-task");
                }
                doOperations.push({
                    action: "update",
                    id: nextId,
                    data: nextElement.outerHTML
                });
            }
            doOperations.push({
                action: "move",
                id: nextId,
                previousID: subPreviousID || getLastChildBlock(lastBlockElement)?.getAttribute("data-node-id"),
                parentID: lastBlockElement.getAttribute("data-node-id")
            });
            undoOperations.push({
                action: "move",
                id: nextId,
                previousID: subPreviousID || lastBlockElement.parentElement?.getAttribute("data-node-id"),
            });
            subPreviousID = nextId;
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            lastBlockElement.lastElementChild.before(tempElement);
        }
        if (lastBlockElement.getAttribute("data-subtype") === "o") {
            Array.from(lastBlockElement.children).forEach(orderItem => {
                const id = orderItem.getAttribute("data-node-id");
                if (id) {
                    undoOperations.push({
                        action: "update",
                        id,
                        data: orderItem.outerHTML,
                    });
                }
            });
            updateListOrder(lastBlockElement, 1);
            Array.from(lastBlockElement.children).forEach(orderItem => {
                const id = orderItem.getAttribute("data-node-id");
                if (id) {
                    doOperations.push({
                        action: "update",
                        id,
                        data: orderItem.outerHTML,
                    });
                }
            });
        }
        if (newId) {
            undoOperations.push({
                action: "delete",
                id: newId
            });
        }
    }
    if (!window.siyuan.config.editor.listLogicalOutdent && liElement.nextElementSibling) {
        // https://github.com/siyuan-note/siyuan/issues/9226
        nextElement = liElement.nextElementSibling;
        let subBlockPreviousID;
        while (nextElement && !nextElement.classList.contains("protyle-attr")) {
            const nextId = nextElement.getAttribute("data-node-id");
            doOperations.push({
                action: "move",
                id: nextId,
                previousID: subBlockPreviousID || lastBlockElement.getAttribute("data-node-id"),
            });
            undoOperations.push({
                action: "move",
                id: nextId,
                previousID: subBlockPreviousID || liElement.getAttribute("data-node-id"),
            });
            subBlockPreviousID = nextId;
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            lastBlockElement.after(tempElement);
            lastBlockElement = tempElement;
        }
    }
    if (liElement.childElementCount === 1 && parentLiItemElement.childElementCount === 3) {
        // https://ld246.com/article/1691981936960
        doOperations.push({
            action: "delete",
            id: parentLiItemElement.getAttribute("data-node-id")
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            id: parentLiItemElement.getAttribute("data-node-id"),
            data: parentLiItemElement.outerHTML,
            previousID: getPreviousBlockSibling(parentLiItemElement)?.getAttribute("data-node-id"),
            // https://github.com/siyuan-note/siyuan/issues/9237 无 previousID
            parentID: getParentBlock(parentLiItemElement).getAttribute("data-node-id"),
        });
        parentLiItemElement.remove();
    } else if (liElement.childElementCount === 1) {
        doOperations.push({
            action: "delete",
            id: liElement.getAttribute("data-node-id")
        });
        undoOperations.splice(0, 0, {
            action: "insert",
            id: liElement.getAttribute("data-node-id"),
            data: liElement.outerHTML,
            previousID: getPreviousBlockSibling(liElement)?.getAttribute("data-node-id")
        });
        liElement.remove();
    } else if (liElement.getAttribute("data-subtype") === "o") {
        undoOperations.splice(0, 0, {
            action: "update",
            data: liElement.outerHTML,
            id: liElement.getAttribute("data-node-id"),
        });
        updateListOrder(liElement, startIndex);
        doOperations.push({
            action: "update",
            data: liElement.outerHTML,
            id: liElement.getAttribute("data-node-id"),
        });
    }
    if (parentParentElement.classList.contains("protyle-wysiwyg")) {
        if (focusedParentListElement) {
            appendFocusedOutdentListUpdate(focusedParentListElement, parentLiItemElement as HTMLElement,
                movedListItemElements, doOperations, undoOperations);
        }
        transaction(protyle, doOperations, undoOperations, {trackedRangeInsertion});
    } else {
        if (parentLiItemElement && parentLiItemElement.getAttribute("data-subtype") === "o") {
            updateListOrder(parentParentElement);
        }
        updateTransaction(protyle, parentParentElement, html, undefined, undefined, {trackedRangeInsertion});
    }
    focusByWbr(parentParentElement, range);
};
