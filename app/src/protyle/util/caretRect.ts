export interface ICaretRect {
    left: number;
    top: number;
    height: number;
}

const getVisibleRects = (rects: DOMRectList | DOMRect[]) => Array.from(rects).filter(rect => rect.height > 0);

const getRectEdge = (rect: DOMRect, useEnd: boolean, isRTL: boolean): ICaretRect => ({
    left: useEnd === isRTL ? rect.left : rect.right,
    top: rect.top,
    height: rect.height,
});

const getNodeBoundaryRect = (range: Range, node: Node, useEnd: boolean, isRTL: boolean) => {
    const boundaryRange = range.cloneRange();
    boundaryRange.selectNodeContents(node);
    boundaryRange.collapse(!useEnd);
    const collapsedRect = boundaryRange.getBoundingClientRect();
    if (collapsedRect.height > 0) {
        return {
            left: collapsedRect.left,
            top: collapsedRect.top,
            height: collapsedRect.height,
        };
    }

    boundaryRange.selectNodeContents(node);
    let rects = getVisibleRects(boundaryRange.getClientRects());
    if (rects.length === 0 && node.nodeType === 1) {
        rects = getVisibleRects((node as Element).getClientRects());
    }
    if (rects.length === 0) {
        return;
    }
    return getRectEdge(useEnd ? rects[rects.length - 1] : rects[0], useEnd, isRTL);
};

const getTextBoundaryRect = (range: Range, node: Node, offset: number, isRTL: boolean) => {
    const textLength = node.textContent?.length || 0;
    if (textLength === 0) {
        return;
    }
    const useEnd = offset > 0;
    const boundaryRange = range.cloneRange();
    boundaryRange.setStart(node, useEnd ? 0 : offset);
    boundaryRange.setEnd(node, useEnd ? Math.min(offset, textLength) : textLength);
    const rects = getVisibleRects(boundaryRange.getClientRects());
    if (rects.length === 0) {
        return;
    }
    return getRectEdge(useEnd ? rects[rects.length - 1] : rects[0], useEnd, isRTL);
};

export const getCaretRect = (range: Range, isRTL = false): ICaretRect | undefined => {
    const rect = range.getBoundingClientRect();
    if (rect.height > 0) {
        return {
            left: rect.left,
            top: rect.top,
            height: rect.height,
        };
    }

    const container = range.startContainer;
    if (container.nodeType === 3) {
        return getTextBoundaryRect(range, container, range.startOffset, isRTL);
    }

    const previousNode = container.childNodes[range.startOffset - 1];
    if (previousNode) {
        const previousRect = getNodeBoundaryRect(range, previousNode, true, isRTL);
        if (previousRect) {
            return previousRect;
        }
    }
    const nextNode = container.childNodes[range.startOffset];
    if (nextNode) {
        return getNodeBoundaryRect(range, nextNode, false, isRTL);
    }
};
