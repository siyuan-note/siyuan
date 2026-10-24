const INLINE_RANGE_ROOT_TAGS = ["DIV", "TD", "TH", "TR"];

export const normalizeInlineMarkRange = (range: Range, editableElement: Element) => {
    const element = range.startContainer as HTMLElement;
    if (!range.collapsed && element === range.endContainer && element !== editableElement &&
        element.nodeType === 1 && element.tagName === "SPAN" && element.hasAttribute("data-type") &&
        range.startOffset === 0 && range.endOffset === element.childNodes.length) {
        range.selectNode(element);
    }
};

export const getSelectedInlineCodeElement = (range: Range): HTMLElement | undefined => {
    if (range.collapsed) {
        return;
    }
    const startElement = range.startContainer.nodeType === 3 ?
        range.startContainer.parentElement : range.startContainer as Element;
    const codeElement = startElement.closest<HTMLElement>('span[data-type~="code"]');
    if (codeElement?.contains(range.endContainer)) {
        return codeElement;
    }
    if (range.startContainer === range.endContainer && range.endOffset === range.startOffset + 1) {
        const selectedElement = range.startContainer.childNodes[range.startOffset] as HTMLElement;
        if (selectedElement?.nodeType === 1 && selectedElement.tagName === "SPAN" &&
            (selectedElement.getAttribute("data-type") || "").split(" ").includes("code")) {
            return selectedElement;
        }
    }
};

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
    if (!["NodeCallout", "NodeTabItem"].includes(blockElement.getAttribute("data-type"))) {
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
