export const getUndoFocusElement = <T>(
    elements: T[],
    indexValue: string | undefined,
    isPreferred: (element: T) => boolean,
) => {
    const index = Number(indexValue);
    const indexedElement = Number.isInteger(index) && index >= 0 ? elements[index] : undefined;
    return indexedElement || elements.find(isPreferred) || elements[0];
};
