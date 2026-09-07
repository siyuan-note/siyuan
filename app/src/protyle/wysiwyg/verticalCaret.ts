import {focusByRange, getSelectionPosition, setFirstNodeRange, setLastNodeRange} from "../util/selection";
import {getNavigableVerticalRects, isCaretRectAtVerticalBoundary} from "./verticalGeometry";
import {getFoldedNavigationOwner, getReachableVerticalRects} from "./verticalVisibility";

export type TVerticalDirection = "up" | "down";

const isCaretHitReachable = (element: Element, rects: DOMRect[]) => {
    const onScreenRects = rects.filter(rect => rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right >= 0 && rect.left < window.innerWidth);
    return onScreenRects.length === 0 || onScreenRects.some(rect => {
        const y = Math.max(0, Math.min(window.innerHeight - 1, (rect.top + rect.bottom) / 2));
        return [rect.left + 0.25, rect.left - 0.25].some(x => {
            const hit = document.elementFromPoint(x, y);
            return hit && (element.contains(hit) || (!element.textContent && hit === element.parentElement));
        });
    });
};

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
    return getReachableVerticalRects(element,
        getNavigableVerticalRects(Array.from(range.getClientRects()), getCodeTrailingBlankLineCount(element)));
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
    if (getFoldedNavigationOwner(element) ||
        getReachableVerticalRects(element, Array.from(element.getClientRects())).length === 0) {
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
            getReachableVerticalRects(element, Array.from(pointRange.getClientRects())).length > 0 &&
            isCaretHitReachable(element, Array.from(pointRange.getClientRects())) &&
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
        if (direction === "down") {
            setFirstNodeRange(element, range);
        } else {
            setLastNodeRange(element, range);
        }
        range.collapse(true);
    }
    const caretRects = Array.from(range.getClientRects());
    let reachableRects: DOMRect[];
    if (caretRects.length > 0) {
        reachableRects = getReachableVerticalRects(element, caretRects);
        if (reachableRects.length === 0) {
            return false;
        }
    } else if (element.textContent || element.querySelector("br, img, .render-node")) {
        return false;
    } else {
        reachableRects = getReachableVerticalRects(element, Array.from(element.getClientRects()));
    }
    // 屏幕内的回退落点必须实际命中编辑区，屏幕外的合法落点交由滚动逻辑展示。
    if (!isCaretHitReachable(element, reachableRects)) {
        return false;
    }
    focusByRange(range);
    return true;
};
