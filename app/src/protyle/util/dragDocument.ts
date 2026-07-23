export const isSameDragEditor = (targetEditor: Pick<Element, "contains">, sourceElement: Element) => {
    return targetEditor.contains(sourceElement);
};

export const uniqueDragIds = (ids: string[]) => {
    return Array.from(new Set(ids.filter(Boolean)));
};
