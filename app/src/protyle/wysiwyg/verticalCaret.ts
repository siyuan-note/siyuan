import {focusByRange, getSelectionPosition, setLastNodeRange} from "../util/selection";
import {getNavigableVerticalRects, isCaretRectAtVerticalBoundary} from "./verticalGeometry";

export type TVerticalDirection = "up" | "down";

const getCodeTrailingBlankLineCount = (element: Element) => {
    if (!element.closest(".code-block")) {
        return;
    }
    const trailingNewlineCount = element.textContent.match(/\n+$/)?.[0].length || 0;
    if (trailingNewlineCount === 0) {
        return;
    }
    return Math.max(0, trailingNewlineCount - 1);
};

const getContentRects = (element: Element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return getNavigableVerticalRects(Array.from(range.getClientRects()), getCodeTrailingBlankLineCount(element));
};

export const isCaretAtVerticalBoundary = (element: Element, range: Range, direction: TVerticalDirection) => {
    if (!element.contains(range.startContainer)) {
        return false;
    }
    const position = getSelectionPosition(element, range);
    return isCaretRectAtVerticalBoundary(position.top, getContentRects(element), direction);
};

export const getCaretGoalX = (range: Range, fallbackElement?: Element) => {
    const rects = Array.from(range.getClientRects());
    const rect = rects[0] || range.getBoundingClientRect();
    if (rect && Number.isFinite(rect.left) && rect.left > 0) {
        return rect.left;
    }
    if (fallbackElement) {
        const position = getSelectionPosition(fallbackElement, range);
        if (Number.isFinite(position.left) && position.left > 0) {
            return position.left;
        }
        return fallbackElement.getBoundingClientRect().left;
    }
    return 0;
};

const getBoundaryLineRects = (element: Element, direction: TVerticalDirection) => {
    const rects = getContentRects(element);
    if (rects.length === 0) {
        return [];
    }
    const boundaryTop = direction === "down" ?
        Math.min(...rects.map(rect => rect.top)) : Math.max(...rects.map(rect => rect.top));
    const lineHeight = Math.min(...rects.map(rect => rect.height));
    const tolerance = Math.max(2, lineHeight / 2);
    return rects.filter(rect => Math.abs(rect.top - boundaryTop) <= tolerance);
};

export const focusEditableAtGoalX = (element: Element, direction: TVerticalDirection, goalX: number) => {
    if (getNavigableVerticalRects(Array.from(element.getClientRects())).length === 0) {
        return false;
    }
    const lineRects = getBoundaryLineRects(element, direction);
    const range = document.createRange();
    if (lineRects.length > 0 && typeof document.caretRangeFromPoint === "function") {
        const lineLeft = Math.min(...lineRects.map(rect => rect.left));
        const lineRight = Math.max(...lineRects.map(rect => rect.right));
        const lineTop = Math.min(...lineRects.map(rect => rect.top));
        const lineBottom = Math.max(...lineRects.map(rect => rect.bottom));
        const x = Math.max(lineLeft + 1, Math.min(goalX, lineRight - 1));
        const pointRange = document.caretRangeFromPoint(x, (lineTop + lineBottom) / 2);
        const isZeroWidthLine = lineRects.every(rect => rect.width <= 0.5);
        if (pointRange && element.contains(pointRange.startContainer) &&
            (!isZeroWidthLine ||
                isCaretRectAtVerticalBoundary(getSelectionPosition(element, pointRange).top, lineRects, "up"))) {
            pointRange.collapse(true);
            focusByRange(pointRange);
            return true;
        }
    }
    if (direction === "up" && getCodeTrailingBlankLineCount(element) !== undefined) {
        setLastNodeRange(element, range);
        if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0 &&
            range.startContainer.textContent[range.startOffset - 1] === "\n") {
            range.setStart(range.startContainer, range.startOffset - 1);
        }
        range.collapse(true);
    } else {
        range.selectNodeContents(element);
        range.collapse(direction === "down");
    }
    focusByRange(range);
    return true;
};
