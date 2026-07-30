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

export const isEntireBlockContentSelected = (start: number, end: number, contentEnd: number) => {
    return start === 0 && end >= contentEnd;
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
