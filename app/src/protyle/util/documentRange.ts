import {getAtomicVerticalNavigationOwner} from "../wysiwyg/verticalNavigationState";

const documentTopEof = new WeakMap<HTMLElement, boolean>();

// 动态回收按响应到达时的选区判断；连续区间在遇到用户位置时停止裁剪。
export const containsCurrentSelection = (element: Element) => {
    const selection = element.ownerDocument.getSelection();
    for (let index = 0; selection && index < selection.rangeCount; index++) {
        const range = selection.getRangeAt(index);
        const atomicOwner = getAtomicVerticalNavigationOwner(range);
        if (range.intersectsNode(element) || atomicOwner && element.contains(atomicOwner)) {
            return true;
        }
    }
    const activeElement = element.ownerDocument.activeElement;
    return activeElement && element.contains(activeElement);
};

export const updateDocumentBottomEof = (wysiwygElement: HTMLElement, preserveCurrent = false) => {
    if (preserveCurrent && wysiwygElement.hasAttribute("data-bottom-eof")) {
        return;
    }
    wysiwygElement.toggleAttribute(
        "data-bottom-eof",
        wysiwygElement.lastElementChild?.getAttribute("data-eof") === "2"
    );
};

const firstBlockMarksDocumentStart = (wysiwygElement: HTMLElement) => {
    const firstElement = wysiwygElement.firstElementChild;
    return firstElement?.getAttribute("data-eof") === "1" || firstElement?.getAttribute("data-node-index") === "0";
};

// 块的转换、移动和删除会替换首块，文档开头是否已加载由正文容器记录。
export const updateDocumentTopEof = (wysiwygElement: HTMLElement, loaded = firstBlockMarksDocumentStart(wysiwygElement)) => {
    documentTopEof.set(wysiwygElement, loaded);
};

export const isDocumentBoundaryLoaded = (wysiwygElement: HTMLElement, position: "before" | "after") => {
    if (position === "after") {
        return wysiwygElement.hasAttribute("data-bottom-eof");
    }
    return Boolean(wysiwygElement.firstElementChild) &&
        (documentTopEof.get(wysiwygElement) ?? firstBlockMarksDocumentStart(wysiwygElement));
};

export const markDocumentBoundaryLoaded = (wysiwygElement: HTMLElement, position: "before" | "after") => {
    const boundaryElement = position === "before" ?
        wysiwygElement.firstElementChild : wysiwygElement.lastElementChild;
    boundaryElement?.setAttribute("data-eof", position === "before" ? "1" : "2");
    if (position === "before") {
        updateDocumentTopEof(wysiwygElement, Boolean(boundaryElement));
    } else {
        updateDocumentBottomEof(wysiwygElement);
    }
};

export const hasUnloadedDocumentBlocks = (wysiwygElement: HTMLElement, dynamicLoad: boolean) => {
    if (!dynamicLoad) {
        return false;
    }
    return !isDocumentBoundaryLoaded(wysiwygElement, "before") ||
        !isDocumentBoundaryLoaded(wysiwygElement, "after");
};
