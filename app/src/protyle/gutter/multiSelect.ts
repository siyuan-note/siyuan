export const hasMultipleBlockSelection = (blockSelectElements: Element[]) => blockSelectElements.length > 1;

export const getSameContainerHeadingLevel = (selectElements: Element[]) => {
    if (selectElements.length < 2) {
        return;
    }
    const firstElement = selectElements[0];
    const subtype = firstElement.getAttribute("data-subtype");
    if (firstElement.getAttribute("data-type") !== "NodeHeading" || !/^h[1-6]$/.test(subtype)) {
        return;
    }
    if (selectElements.some((item) => item.getAttribute("data-type") !== "NodeHeading" ||
        item.getAttribute("data-subtype") !== subtype || item.parentElement !== firstElement.parentElement)) {
        return;
    }
    return Number.parseInt(subtype.substring(1));
};

export const getGutterSelection = (blockSelectElements: Element[], rangeSelectElements: Element[]) => {
    if (hasMultipleBlockSelection(blockSelectElements)) {
        return {isMultiSelect: true, selectElements: blockSelectElements};
    }
    if (rangeSelectElements.length > 0) {
        return {isMultiSelect: true, selectElements: rangeSelectElements};
    }
    return {isMultiSelect: false, selectElements: blockSelectElements};
};

export const getGutterSelectionTarget = (selectElements: Element[], element: Element) => {
    const selectElementSet = new Set(selectElements);
    let currentElement: Element | null = element;
    while (currentElement) {
        if (selectElementSet.has(currentElement)) {
            return currentElement;
        }
        currentElement = currentElement.parentElement;
    }
};

export const getCrossBlockTextSelectionTarget = (blockSelectElements: Element[], rangeSelectElements: Element[],
                                                  element: Element) => {
    if (hasMultipleBlockSelection(blockSelectElements)) {
        return;
    }
    return getGutterSelectionTarget(rangeSelectElements, element);
};

export const isCrossBlockTextRange = (range: Range | undefined, boundaryElement: Element,
                                      getBlock: (node: Node) => Element | false) => {
    if (!range || range.collapsed || !boundaryElement.contains(range.startContainer) ||
        !boundaryElement.contains(range.endContainer)) {
        return false;
    }
    const startElement = getBlock(range.startContainer);
    const endElement = getBlock(range.endContainer);
    return !!startElement && !!endElement && startElement !== endElement;
};

export const isGutterInsertStateMatched = (insertElementCount: number, shouldRenderInsert: boolean) =>
    insertElementCount === (shouldRenderInsert ? 4 : 0);
