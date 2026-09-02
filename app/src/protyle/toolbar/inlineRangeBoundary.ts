const INLINE_RANGE_ROOT_TAGS = ["DIV", "TD", "TH", "TR"];

export const getInlineRangeElement = (container: Node, editableElement: Element) => {
    const parentElement = container.parentElement;
    if (container.nodeType !== 3 || !parentElement || parentElement === editableElement ||
        parentElement.tagName !== "SPAN") {
        return;
    }
    return parentElement;
};

export const canExpandInlineRangeToParent = (container: Node, editableElement: Element) => {
    const parentElement = container.parentElement;
    return !!parentElement && parentElement !== editableElement && !INLINE_RANGE_ROOT_TAGS.includes(parentElement.tagName);
};
