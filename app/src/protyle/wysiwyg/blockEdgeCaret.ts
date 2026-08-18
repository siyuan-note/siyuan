type TBlockEdgeCaretRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;
type TBlockEdgeCaretDirection = "left" | "right";

interface IBlockEdgeCaretRange {
    range: Range;
    lineBoundaryDirection: TBlockEdgeCaretDirection;
}

export const getBlockEdgeCaretPoint = (x: number, y: number, contentLeft: number, contentRight: number,
                                       editableRect: TBlockEdgeCaretRect) => {
    const fromLeft = x < contentLeft;
    const fromRight = x > contentRight;
    if ((!fromLeft && !fromRight) || y < editableRect.top || y > editableRect.bottom ||
        editableRect.right <= editableRect.left || editableRect.bottom <= editableRect.top) {
        return;
    }

    const horizontalInset = Math.min(4, (editableRect.right - editableRect.left) / 2);
    const verticalInset = Math.min(1, (editableRect.bottom - editableRect.top) / 2);
    return {
        x: fromLeft ? editableRect.left + horizontalInset : editableRect.right - horizontalInset,
        y: Math.max(editableRect.top + verticalInset, Math.min(y, editableRect.bottom - verticalInset)),
    };
};

export const isCaretRangeInsideElement = (range: Range | null | undefined, element: Element) => {
    if (!range || !range.collapsed) {
        return false;
    }
    const contains = (node: Node) => node === element || element.contains(node);
    return contains(range.startContainer) && contains(range.endContainer);
};

const isCaretRangeOnVisualLine = (range: Range, y: number) => {
    const rects = range.getClientRects();
    if (rects.length === 0) {
        return false;
    }
    const rect = rects[rects.length - 1];
    return y >= rect.top - 4 && y <= rect.bottom + 4;
};

export const getBlockEdgeCaretRange = (x: number, y: number, contentLeft: number, contentRight: number,
                                       editableRect: TBlockEdgeCaretRect, editableElement: Element,
                                       rangeFromPoint: (x: number, y: number) => Range | null):
    IBlockEdgeCaretRange | undefined => {
    const point = getBlockEdgeCaretPoint(x, y, contentLeft, contentRight, editableRect);
    if (!point) {
        return;
    }
    const fromLeft = x < contentLeft;
    const getValidRange = (probeX: number) => {
        const range = rangeFromPoint(probeX, point.y);
        return isCaretRangeInsideElement(range, editableElement) ? range : undefined;
    };
    const edgeRange = getValidRange(point.x);
    if (!edgeRange) {
        return;
    }
    if (isCaretRangeOnVisualLine(edgeRange, point.y)) {
        return {
            range: edgeRange,
            lineBoundaryDirection: fromLeft ? "left" : "right",
        };
    }

    // 软折行边界的 Range 可能显示在相邻行，先向内容内部寻找目标视觉行
    const horizontalInset = Math.min(4, (editableRect.right - editableRect.left) / 2);
    const oppositeX = fromLeft ? editableRect.right - horizontalInset : editableRect.left + horizontalInset;
    for (let index = 1; index <= 16; index++) {
        const probeX = point.x + (oppositeX - point.x) * index / 16;
        const range = getValidRange(probeX);
        if (range && isCaretRangeOnVisualLine(range, point.y)) {
            return {
                range,
                lineBoundaryDirection: fromLeft ? "left" : "right",
            };
        }
    }
};
