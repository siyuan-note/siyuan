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
    replacementListItemElement?: HTMLElement;
    startListElement: HTMLElement;
    startListItemElement: HTMLElement;
    startOuterListItemElement: HTMLElement;
    startTextFullySelected: boolean;
    startTrailingListItems: HTMLElement[];
}

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
    let replacementListItemElement: HTMLElement;
    if (!startOuterListItemElement) {
        startOuterListItemElement = startListItemElement;
        const previousOuterListItemElement = startOuterListItemElement.previousElementSibling as HTMLElement;
        startListElement = Array.from(previousOuterListItemElement?.children || []).find(item =>
            item.getAttribute("data-type") === "NodeList") as HTMLElement;
        startMergeListItemElement = Array.from(startListElement?.children || []).reverse().find(item =>
            item.getAttribute("data-type") === "NodeListItem") as HTMLElement;
        if (!startListElement || !startMergeListItemElement ||
            !isTextContentSelected(startOuterListItemElement) ||
            startOuterListItemElement.parentElement !== endOuterListItemElement.parentElement) {
            return;
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
    const startTrailingListItems = Array.from(startListElement.children).filter(item =>
        item.getAttribute("data-type") === "NodeListItem" &&
        !!(startMergeListItemElement.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING)) as HTMLElement[];
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
