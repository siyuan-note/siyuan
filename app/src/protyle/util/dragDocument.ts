export const isSameDragEditor = (targetEditor: Pick<Element, "contains">, sourceElement: Element) => {
    return targetEditor.contains(sourceElement);
};

export const BLOCK_DRAGOVER_SELECTOR = [
    ".dragover__left",
    ".dragover__right",
    ".dragover__bottom",
    ".dragover__top",
    ".dragover__bottom--sibling",
    ".dragover__top--sibling",
    ".dragover__bottom--child",
    ".dragover__top--child",
].join(", ");

export const getBlockDragoverTarget = (scope: HTMLElement, cachedTarget?: Element) => {
    const cachedTargetInScope = !!cachedTarget && scope.contains(cachedTarget);
    if (cachedTargetInScope && cachedTarget.matches(BLOCK_DRAGOVER_SELECTOR)) {
        return cachedTarget;
    }
    return scope.querySelector(BLOCK_DRAGOVER_SELECTOR) || (cachedTargetInScope ? cachedTarget : null);
};

export const isAttributeViewTitleTarget = (targetNode: Node | null, point?: {x: number, y: number}) => {
    if (!targetNode) {
        return false;
    }
    const targetElement = targetNode.nodeType === 3 ? targetNode.parentElement : targetNode as Element;
    let attributeViewElement: Element | null = null;
    for (let element = targetElement; element; element = element.parentElement) {
        if (element.classList.contains("av__title")) {
            return true;
        }
        if (!attributeViewElement && element.classList.contains("av")) {
            attributeViewElement = element;
        }
    }
    if (!attributeViewElement || !point) {
        return false;
    }
    const titleElement = attributeViewElement.querySelector(".av__title") as HTMLElement;
    if (!titleElement || titleElement.classList.contains("fn__none")) {
        return false;
    }
    const rect = titleElement.getBoundingClientRect();
    const hitSlop = 12;
    return rect.width > 0 && rect.height > 0 && point.x >= rect.left - hitSlop && point.x <= rect.right + hitSlop &&
        point.y >= rect.top - hitSlop && point.y <= rect.bottom + hitSlop;
};

export const isDragTargetInSource = (sourceElements: Element[], targetElement: Element) => {
    const sourceIDs = new Set(sourceElements.map(item => item.getAttribute("data-node-id")).filter(Boolean));
    for (let target = targetElement; target; target = target.parentElement) {
        if (sourceIDs.has(target.getAttribute("data-node-id"))) {
            return true;
        }
    }
    return false;
};

export const uniqueDragIds = (ids: string[]) => {
    return Array.from(new Set(ids.filter(Boolean)));
};

export const getAVRowDropTarget = (targetElement: HTMLElement | false): HTMLElement | false => {
    if (!targetElement || !targetElement.classList.contains("av__row--util")) {
        return targetElement;
    }
    let rowElement = targetElement.previousElementSibling as HTMLElement;
    while (rowElement && !rowElement.matches(".av__row[data-id], .av__row--header")) {
        rowElement = rowElement.previousElementSibling as HTMLElement;
    }
    return rowElement || targetElement;
};

export const isSameSiblingMove = <T>(siblings: T[], sources: T[], target: T, isBottom: boolean) => {
    if (sources.length === 0 || sources.includes(target)) {
        return sources.includes(target);
    }
    const sourceSet = new Set(sources);
    if (!siblings.includes(target) || sources.some(item => !siblings.includes(item))) {
        return false;
    }
    const orderedSources = siblings.filter(item => sourceSet.has(item));
    const reordered = siblings.filter(item => !sourceSet.has(item));
    const targetIndex = reordered.indexOf(target);
    reordered.splice(targetIndex + (isBottom ? 1 : 0), 0, ...orderedSources);
    return reordered.every((item, index) => item === siblings[index]);
};

export const getSameSuperBlockEdgeTarget = (sourceElements: Element[], targetElement: Element, isRight: boolean) => {
    if (targetElement.getAttribute("data-type") !== "NodeSuperBlock" ||
        targetElement.getAttribute("data-sb-layout") !== "col" ||
        sourceElements.length === 0 || sourceElements.some(item => item.parentElement !== targetElement)) {
        return;
    }
    const childBlocks = Array.from(targetElement.children).filter(item => item.hasAttribute("data-node-id"));
    return childBlocks[isRight ? childBlocks.length - 1 : 0];
};

export const getSuperBlockResizeDropTarget = (resizeElement: HTMLElement | false): HTMLElement | undefined => {
    if (!resizeElement || !resizeElement.classList.contains("sb__resize")) {
        return;
    }
    const superBlock = resizeElement.parentElement;
    if (superBlock?.getAttribute("data-type") !== "NodeSuperBlock" ||
        superBlock.getAttribute("data-sb-layout") !== "col") {
        return;
    }
    let targetElement = resizeElement.previousElementSibling as HTMLElement;
    while (targetElement && !targetElement.hasAttribute("data-node-id")) {
        targetElement = targetElement.previousElementSibling as HTMLElement;
    }
    return targetElement;
};

export const getTopListDragTarget = (targetElement: Element) => {
    let topList = targetElement;
    while (topList.parentElement?.classList.contains("li") ||
           topList.parentElement?.classList.contains("list")) {
        topList = topList.parentElement;
        if (topList.classList.contains("list") && !topList.parentElement?.classList.contains("li")) {
            break;
        }
    }
    return topList;
};

export const shouldKeepListBlockDragTarget = (sourceType: string, isHorizontalDrop: boolean,
                                               isColumnSuperBlockChild: boolean) =>
    sourceType === "nodelist" && (isHorizontalDrop || isColumnSuperBlockChild);

export const replaceDragUndoOperation = <T>(operations: T[], operation: T, replacements: T[]) => {
    const index = operations.indexOf(operation);
    if (index < 0) {
        return false;
    }
    operations.splice(index, 1, ...replacements);
    return true;
};
