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
