type TBlockEdgeCaretRect = Pick<DOMRect, "left" | "right" | "top" | "bottom">;

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
