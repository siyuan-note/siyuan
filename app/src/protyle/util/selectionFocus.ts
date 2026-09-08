export const getUndoFocusElement = <T>(
    elements: T[],
    indexValue: string | undefined,
    isPreferred: (element: T) => boolean,
) => {
    if (indexValue !== undefined) {
        const index = Number(indexValue);
        return Number.isInteger(index) && index >= 0 ? elements[index] : undefined;
    }
    const candidates = elements.filter(isPreferred);
    return candidates.length === 1 ? candidates[0] : elements.length === 1 ? elements[0] : undefined;
};

export const getUndoFocusTarget = <T>(elements: T[], containsSelection: (element: T) => boolean) => {
    return elements.find(containsSelection) || elements[0];
};
