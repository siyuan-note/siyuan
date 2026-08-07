export const getMultiSelectGutterTarget = (selectElements: Element[], element: Element) => {
    if (selectElements.length <= 1) {
        return;
    }
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
