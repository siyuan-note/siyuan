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

export const canRemoveEmptyInlineElement = (element: Element, editableElement: Element) =>
    element !== editableElement && !["TD", "TH", "BR"].includes(element.tagName);

export const normalizeCalloutTitleRange = (range: Range, blockElement: Element,
                                           editableElement: Element) => {
    if (blockElement.getAttribute("data-type") !== "NodeCallout") {
        return editableElement;
    }
    const titleElement = blockElement.querySelector(":scope > .callout-info > .callout-title");
    const infoElement = titleElement?.parentElement;
    if (!titleElement || !infoElement ||
        !(range.startContainer === infoElement || infoElement.contains(range.startContainer)) ||
        !(range.endContainer === infoElement || infoElement.contains(range.endContainer)) ||
        !range.intersectsNode(titleElement)) {
        return editableElement;
    }
    if (!titleElement.contains(range.startContainer)) {
        range.setStart(titleElement, 0);
    }
    if (!titleElement.contains(range.endContainer)) {
        range.setEnd(titleElement, titleElement.childNodes.length);
    }
    return titleElement;
};
