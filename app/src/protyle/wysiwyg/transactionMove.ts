const getNextBlockElement = (element: Element) => {
    let nextElement = element.nextElementSibling;
    while (nextElement && !nextElement.getAttribute("data-node-id")) {
        nextElement = nextElement.nextElementSibling;
    }
    return nextElement;
};

export const getVisibleMoveElements = (sourceElement: Element, blockIDs?: string[]) => {
    const elements = [sourceElement];
    if (!blockIDs?.length) {
        return elements;
    }

    let blockIndex = 0;
    let nextElement = getNextBlockElement(sourceElement);
    while (nextElement) {
        const id = nextElement.getAttribute("data-node-id");
        if (!id) {
            break;
        }
        const matchedIndex = blockIDs.indexOf(id, blockIndex);
        if (matchedIndex < 0) {
            break;
        }
        elements.push(nextElement);
        blockIndex = matchedIndex + 1;
        if (blockIndex === blockIDs.length) {
            break;
        }
        nextElement = getNextBlockElement(nextElement);
    }
    return elements;
};

export const cloneMoveElements = (elements: Element[]) =>
    elements.map(item => item.cloneNode(true) as Element);
