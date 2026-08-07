export const getGutterSelection = (blockSelectElements: Element[], rangeSelectElements: Element[]) => {
    if (blockSelectElements.length > 1) {
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

export const isGutterInsertStateMatched = (insertElementCount: number, shouldRenderInsert: boolean) =>
    insertElementCount === (shouldRenderInsert ? 4 : 0);
