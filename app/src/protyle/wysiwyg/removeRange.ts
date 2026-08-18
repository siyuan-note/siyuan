const getNextBlockSibling = (element: Element) => {
    let nextElement = element.nextElementSibling;
    while (nextElement && !nextElement.hasAttribute("data-node-id")) {
        nextElement = nextElement.nextElementSibling;
    }
    return nextElement;
};

const getListItemElement = (element: HTMLElement, editorElement: HTMLElement) => {
    let currentElement = element.parentElement;
    while (currentElement && currentElement !== editorElement) {
        if (currentElement.getAttribute("data-type") === "NodeListItem") {
            return currentElement;
        }
        currentElement = currentElement.parentElement;
    }
};

export interface ICrossBlockNestedListMergeContext {
    endListItemElement: HTMLElement;
    endOuterListItemElement: HTMLElement;
    newListData?: string;
    newListParentElement?: HTMLElement;
    replacementListItemElement?: HTMLElement;
    startListElement: HTMLElement;
    startListItemElement?: HTMLElement;
    startOuterListItemElement: HTMLElement;
    startTextFullySelected: boolean;
    startTrailingListItems: HTMLElement[];
}

export interface ICrossBlockSiblingListItemMergeContext {
    endListElement: HTMLElement;
    endListItemElement: HTMLElement;
    removeEndElement: HTMLElement;
    startListElement: HTMLElement;
    startListItemElement: HTMLElement;
    trailingEndBlockElements: HTMLElement[];
    trailingEndListItemElements: HTMLElement[];
}

export const getCrossBlockEndAction = (startType: string, endType: string, endFullySelected: boolean,
                                       endFolded: boolean): "merge" | "delete" | undefined => {
    if (endFolded) {
        return;
    }
    if (["NodeParagraph", "NodeHeading"].includes(startType) && startType === endType) {
        return "merge";
    }
    if (["NodeParagraph", "NodeHeading"].includes(endType) && endFullySelected) {
        return "delete";
    }
};

export const getCrossBlockSiblingListItemMergeContext = (editorElement: HTMLElement,
                                                          startElement: HTMLElement,
                                                          endElement: HTMLElement):
ICrossBlockSiblingListItemMergeContext | undefined => {
    const startListItemElement = getListItemElement(startElement, editorElement);
    const endListItemElement = getListItemElement(endElement, editorElement);
    const startListElement = startListItemElement?.parentElement;
    const endListElement = endListItemElement?.parentElement;
    const blockType = startElement.getAttribute("data-type");
    if (blockType !== endElement.getAttribute("data-type") ||
        !["NodeParagraph", "NodeHeading"].includes(blockType)) {
        return;
    }
    if (!startListItemElement || !endListItemElement || !startListElement || !endListElement ||
        startListItemElement === endListItemElement || startElement.parentElement !== startListItemElement ||
        endElement.parentElement !== endListItemElement || startListElement.getAttribute("data-type") !== "NodeList" ||
        endListElement.getAttribute("data-type") !== "NodeList" ||
        startListElement.getAttribute("data-subtype") !== endListElement.getAttribute("data-subtype")) {
        return;
    }
    const sameList = startListElement === endListElement;
    if (!sameList && startListElement.parentElement !== endListElement.parentElement) {
        return;
    }
    let siblingElement = sameList ? startListItemElement.nextElementSibling : startListElement.nextElementSibling;
    const endSiblingElement = sameList ? endListItemElement : endListElement;
    while (siblingElement && siblingElement !== endSiblingElement) {
        siblingElement = siblingElement.nextElementSibling;
    }
    if (siblingElement !== endSiblingElement) {
        return;
    }
    const trailingEndBlockElements: HTMLElement[] = [];
    siblingElement = endElement.nextElementSibling;
    while (siblingElement) {
        if (siblingElement.hasAttribute("data-node-id")) {
            trailingEndBlockElements.push(siblingElement as HTMLElement);
        }
        siblingElement = siblingElement.nextElementSibling;
    }
    if (trailingEndBlockElements.length === 0) {
        return;
    }
    const trailingEndListItemElements: HTMLElement[] = [];
    if (!sameList) {
        let trailingListItemElement = endListItemElement.nextElementSibling as HTMLElement;
        while (trailingListItemElement?.getAttribute("data-type") === "NodeListItem") {
            trailingEndListItemElements.push(trailingListItemElement);
            trailingListItemElement = trailingListItemElement.nextElementSibling as HTMLElement;
        }
    }
    return {
        endListElement,
        endListItemElement,
        removeEndElement: sameList ? endListItemElement : endListElement,
        startListElement,
        startListItemElement,
        trailingEndBlockElements,
        trailingEndListItemElements,
    };
};

export const mergeCrossBlockSiblingListItems = (context: ICrossBlockSiblingListItemMergeContext) => {
    context.trailingEndBlockElements.forEach(item => {
        context.startListItemElement.lastElementChild.before(item);
    });
    context.trailingEndListItemElements.forEach(item => {
        context.startListElement.lastElementChild.before(item);
    });
    return {
        movedEndBlocks: context.trailingEndBlockElements,
        movedEndListItems: context.trailingEndListItemElements,
    };
};

export const getCrossBlockNestedListMergeContext = (editorElement: HTMLElement, selectedRange: Range,
                                                     startElement: HTMLElement, endElement: HTMLElement):
ICrossBlockNestedListMergeContext | undefined => {
    const isTextContentSelected = (element: Element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let hasText = false;
        let textNode = walker.nextNode();
        while (textNode) {
            if (textNode.textContent.replace(/[\s\u200b]/g, "") !== "") {
                hasText = true;
                if (selectedRange.comparePoint(textNode, 0) !== 0 ||
                    selectedRange.comparePoint(textNode, textNode.textContent.length) !== 0) {
                    return false;
                }
            }
            textNode = walker.nextNode();
        }
        return hasText;
    };
    if (startElement.getAttribute("data-type") !== "NodeParagraph" ||
        endElement.getAttribute("data-type") !== "NodeParagraph") {
        return;
    }
    const startListItemElement = getListItemElement(startElement, editorElement);
    const endListItemElement = getListItemElement(endElement, editorElement);
    const boundaryStartListElement = startListItemElement?.parentElement;
    const endListElement = endListItemElement?.parentElement;
    if (!boundaryStartListElement || !endListElement || boundaryStartListElement === endListElement ||
        boundaryStartListElement.getAttribute("data-type") !== "NodeList" ||
        endListElement.getAttribute("data-type") !== "NodeList" ||
        boundaryStartListElement.getAttribute("data-subtype") === "o") {
        return;
    }
    const endOuterListItemElement = getListItemElement(endListElement, editorElement);
    if (!endOuterListItemElement) {
        return;
    }
    let startListElement = boundaryStartListElement;
    let startMergeListItemElement = startListItemElement;
    let startOuterListItemElement = getListItemElement(boundaryStartListElement, editorElement);
    let newListData: string;
    let newListParentElement: HTMLElement;
    let replacementListItemElement: HTMLElement;
    if (!startOuterListItemElement) {
        startOuterListItemElement = startListItemElement;
        const previousOuterListItemElement = startOuterListItemElement.previousElementSibling as HTMLElement;
        startListElement = Array.from(previousOuterListItemElement?.children || []).find(item =>
            item.getAttribute("data-type") === "NodeList") as HTMLElement;
        if (!previousOuterListItemElement || !isTextContentSelected(startOuterListItemElement) ||
            startOuterListItemElement.parentElement !== endOuterListItemElement.parentElement) {
            return;
        }
        if (startListElement) {
            startMergeListItemElement = Array.from(startListElement.children).reverse().find(item =>
                item.getAttribute("data-type") === "NodeListItem") as HTMLElement;
            if (!startMergeListItemElement) {
                return;
            }
        } else {
            const newListID = Lute.NewNodeID();
            startListElement = document.createElement("div");
            startListElement.className = "list";
            startListElement.setAttribute("data-node-id", newListID);
            startListElement.setAttribute("data-subtype", endListElement.getAttribute("data-subtype"));
            startListElement.setAttribute("data-type", "NodeList");
            startListElement.setAttribute("updated", newListID.split("-")[0]);
            startListElement.innerHTML = '<div class="protyle-attr" contenteditable="false">\u200b</div>';
            newListData = startListElement.outerHTML;
            newListParentElement = previousOuterListItemElement;
            startMergeListItemElement = undefined;
        }
        replacementListItemElement = startOuterListItemElement;
    }
    if (startOuterListItemElement.parentElement !== endOuterListItemElement.parentElement ||
        !(startOuterListItemElement.compareDocumentPosition(endOuterListItemElement) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        return;
    }
    if (startListElement.getAttribute("data-subtype") !== endListElement.getAttribute("data-subtype")) {
        return;
    }
    const endItemBlocks = Array.from(endListItemElement.children).filter(item => item.hasAttribute("data-node-id"));
    const startTrailingListItems = startMergeListItemElement ? Array.from(startListElement.children).filter(item =>
        item.getAttribute("data-type") === "NodeListItem" &&
        !!(startMergeListItemElement.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)) as HTMLElement[] : [];
    const trailingItems = Array.from(endListElement.children).filter(item =>
        item.getAttribute("data-type") === "NodeListItem" &&
        !!(endListItemElement.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING));
    if (endItemBlocks.length !== 1 || endItemBlocks[0] !== endElement || trailingItems.length === 0) {
        return;
    }
    if (!isTextContentSelected(endElement.firstElementChild)) {
        return;
    }
    const endOuterBlocks = Array.from(endOuterListItemElement.children).filter(item =>
        item.hasAttribute("data-node-id") && item !== endListElement);
    if (endOuterBlocks.length === 0 || endOuterBlocks.some(item => {
        const editableElement = item.firstElementChild;
        if (!editableElement?.hasAttribute("contenteditable")) {
            return true;
        }
        return !isTextContentSelected(editableElement);
    })) {
        return;
    }
    return {
        endListItemElement,
        endOuterListItemElement,
        newListData,
        newListParentElement,
        replacementListItemElement,
        startListElement,
        startListItemElement: startMergeListItemElement,
        startOuterListItemElement,
        startTextFullySelected: isTextContentSelected(startElement.firstElementChild),
        startTrailingListItems,
    };
};

export const mergeCrossBlockNestedLists = (context: ICrossBlockNestedListMergeContext) => {
    const movedItems: HTMLElement[] = [];
    let item = context.endListItemElement.nextElementSibling as HTMLElement;
    while (item?.getAttribute("data-type") === "NodeListItem") {
        const nextItem = item.nextElementSibling as HTMLElement;
        context.startListElement.lastElementChild.before(item);
        movedItems.push(item);
        item = nextItem;
    }
    if (context.newListParentElement) {
        context.newListParentElement.lastElementChild.before(context.startListElement);
    }
    return movedItems;
};

export const isEntireBlockContentSelected = (selectedRange: Range, contentRange: Range) => {
    const startToStart = 0;
    const endToEnd = 2;
    return selectedRange.compareBoundaryPoints(startToStart, contentRange) <= 0 &&
        selectedRange.compareBoundaryPoints(endToEnd, contentRange) >= 0;
};

export const getBlockRefCheckElementChain = (element: HTMLElement, topElement: HTMLElement) => {
    const elements: HTMLElement[] = [];
    let currentElement: HTMLElement | null = element;
    while (currentElement && topElement.contains(currentElement)) {
        if (currentElement.hasAttribute("data-node-id")) {
            elements.push(currentElement);
        }
        if (currentElement === topElement) {
            break;
        }
        currentElement = currentElement.parentElement;
    }
    return elements;
};

export const getDeletedBlockElements = (removedElements: HTMLElement[], retainedElements: HTMLElement[]) => {
    const elementsByID = new Map<string, HTMLElement>();
    const expansionStopIDs = new Set<string>();
    removedElements.forEach(item => {
        [item, ...Array.from(item.querySelectorAll<HTMLElement>("[data-node-id]"))].forEach(element => {
            let currentElement: HTMLElement | null = element;
            while (currentElement && !currentElement.classList.contains("protyle-wysiwyg__embed")) {
                currentElement = currentElement.parentElement;
            }
            if (currentElement) {
                return;
            }
            if (retainedElements.some(retainedElement =>
                retainedElement === element || retainedElement.contains(element))) {
                return;
            }
            const id = element.getAttribute("data-node-id");
            if (!id) {
                return;
            }
            elementsByID.set(id, element);
            if (retainedElements.some(retainedElement => element.contains(retainedElement))) {
                expansionStopIDs.add(id);
            }
        });
    });
    return {
        elements: Array.from(elementsByID.values()),
        expansionStopIDs,
    };
};

export const getCrossBlockMergeRemoveElement = (editorElement: HTMLElement, startElement: HTMLElement,
                                                endElement: HTMLElement) => {
    let topElement = endElement;
    const endListItemElement = getListItemElement(endElement, editorElement);
    let currentElement = endElement;
    while (currentElement.parentElement && currentElement.parentElement !== editorElement &&
        !currentElement.parentElement.contains(startElement) && !getNextBlockSibling(currentElement)) {
        currentElement = currentElement.parentElement;
        if (currentElement.hasAttribute("data-node-id")) {
            topElement = currentElement;
        }
    }
    const nextBlockElement = getNextBlockSibling(currentElement);
    const hasChildList = !!endListItemElement && !endListItemElement.contains(startElement) &&
        nextBlockElement?.getAttribute("data-type") === "NodeList" &&
        nextBlockElement.parentElement === endListItemElement;
    return hasChildList ? undefined : topElement;
};
