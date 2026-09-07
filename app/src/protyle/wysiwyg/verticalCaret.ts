import {focusByRange, getSelectionPosition, setFirstNodeRange, setLastNodeRange} from "../util/selection";
import {
    getCodeTrailingZeroWidthLineLimit,
    getNavigableVerticalRects,
    getRectsIntersectingVerticalLine,
    getRevealDelta,
    isCaretRectAtVerticalBoundary,
} from "./verticalGeometry";
import {getFoldedNavigationOwner, getReachableVerticalRects} from "./verticalVisibility";

export type TVerticalDirection = "up" | "down";

const isCaretHitReachable = (element: Element, rects: DOMRect[]) => {
    const onScreenRects = rects.filter(rect => rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right >= 0 && rect.left < window.innerWidth);
    return onScreenRects.some(rect => {
        const y = Math.max(0, Math.min(window.innerHeight - 1, (rect.top + rect.bottom) / 2));
        return [rect.left + 0.25, rect.left - 0.25].some(x => {
            const hit = document.elementFromPoint(x, y);
            return hit && (element.contains(hit) || (!element.textContent && hit === element.parentElement));
        });
    });
};

const getRangeContextElement = (range: Range) => range.startContainer.nodeType === Node.ELEMENT_NODE ?
    range.startContainer as Element : range.startContainer.parentElement;

// 折叠 Range 可能没有自身矩形，用相邻内容验证其所在行，不向正文插入占位字符。
const getRangeContextRects = (range: Range, contextElement: Element) => {
    const rangeRects = Array.from(range.getClientRects());
    if (rangeRects.length > 0) {
        return rangeRects;
    }
    const contextRects: DOMRect[] = [];
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
        const textNode = range.startContainer as Text;
        const offsets = [
            [Math.max(0, range.startOffset - 1), range.startOffset],
            [range.startOffset, Math.min(textNode.length, range.startOffset + 1)],
        ];
        offsets.forEach(([start, end]) => {
            if (start === end) {
                return;
            }
            const probeRange = contextElement.ownerDocument.createRange();
            probeRange.setStart(textNode, start);
            probeRange.setEnd(textNode, end);
            contextRects.push(...Array.from(probeRange.getClientRects()));
        });
        if (contextRects.length === 0) {
            contextRects.push(...Array.from(contextElement.getClientRects()));
        }
    } else if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
        const container = range.startContainer as Element;
        [container.childNodes[range.startOffset - 1], container.childNodes[range.startOffset]].forEach(node => {
            if (!node) {
                return;
            }
            const probeRange = contextElement.ownerDocument.createRange();
            probeRange.selectNode(node);
            contextRects.push(...Array.from(probeRange.getClientRects()));
        });
        if (contextRects.length === 0) {
            contextRects.push(...Array.from(container.getClientRects()));
        }
    } else {
        contextRects.push(...Array.from(contextElement.getClientRects()));
    }
    return contextRects;
};

const getRangeRectsOnLine = (element: Element, range: Range, lineRects: DOMRect[]) => {
    const contextElement = getRangeContextElement(range);
    if (!contextElement || !element.contains(contextElement)) {
        return [];
    }
    return getRectsIntersectingVerticalLine(
        getReachableVerticalRects(contextElement, getRangeContextRects(range, contextElement)), lineRects);
};

const getCodeTrailingBlankLineCount = (element: Element) => {
    if (!element.closest(".code-block")) {
        return;
    }
    return getCodeTrailingZeroWidthLineLimit(element.textContent);
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

interface IEditableVerticalNavigationTarget {
    element: Element;
    direction: TVerticalDirection;
    range: Range;
}

// 目标解析只计算合法 Range，Selection 统一在滚动和复核完成后提交。
const resolveEditableVerticalNavigationTarget = (element: Element, direction: TVerticalDirection, goalX: number,
                                                  requireHit: boolean): IEditableVerticalNavigationTarget | undefined => {
    if (getFoldedNavigationOwner(element) ||
        getReachableVerticalRects(element, Array.from(element.getClientRects())).length === 0) {
        return;
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
        const pointRangeRects = pointRange ? getRangeRectsOnLine(element, pointRange, lineRects) : [];
        const pointRangeHasOwnRects = !!pointRange && pointRange.getClientRects().length > 0;
        if (pointRange && element.contains(pointRange.startContainer) && pointRangeRects.length > 0 &&
            (!requireHit || isCaretHitReachable(element, pointRangeHasOwnRects ? pointRangeRects : lineRects)) &&
            (!isZeroWidthLine || !pointRangeHasOwnRects ||
                isCaretRectAtVerticalBoundary(getSelectionPosition(element, pointRange).top, lineRects, "up"))) {
            pointRange.collapse(true);
            return {element, direction, range: pointRange};
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
        reachableRects = lineRects.length > 0 ? getRangeRectsOnLine(element, range, lineRects) :
            getReachableVerticalRects(element, caretRects);
        if (reachableRects.length === 0) {
            return;
        }
    } else if (lineRects.length > 0) {
        reachableRects = getRangeRectsOnLine(element, range, lineRects);
        if (reachableRects.length === 0) {
            return;
        }
    } else if (element.textContent || element.querySelector("img, .render-node")) {
        return;
    } else {
        reachableRects = getReachableVerticalRects(element, Array.from(element.getClientRects()));
    }
    if (requireHit && !isCaretHitReachable(element, reachableRects)) {
        return;
    }
    return {element, direction, range};
};

const getEditableTargetRects = (target: IEditableVerticalNavigationTarget) => {
    const lineRects = getBoundaryLineRects(target.element, target.direction);
    if (lineRects.length > 0) {
        return lineRects;
    }
    const contextElement = getRangeContextElement(target.range);
    if (contextElement && target.element.contains(contextElement)) {
        const contextRects = getReachableVerticalRects(contextElement,
            getRangeContextRects(target.range, contextElement));
        if (contextRects.length > 0) {
            return contextRects;
        }
    }
    return getReachableVerticalRects(target.element, Array.from(target.element.getClientRects()));
};

const revealEditableVerticalNavigationTarget = (target: IEditableVerticalNavigationTarget,
                                                boundaryElement?: Element) => {
    const closestBlock = target.element.closest("[data-node-id]");
    const scrollBoundary = boundaryElement?.contains(target.element) ? boundaryElement : closestBlock || target.element;
    let ancestor: Element | null = target.element;
    while (ancestor) {
        const scrollElement = ancestor as HTMLElement;
        const view = ancestor.ownerDocument.defaultView;
        const style = view?.getComputedStyle(ancestor);
        const canScrollY = scrollElement.scrollHeight > scrollElement.clientHeight + 1 &&
            (ancestor === scrollBoundary || ["auto", "scroll", "overlay"].includes(style?.overflowY));
        if (canScrollY) {
            const rects = getEditableTargetRects(target);
            if (rects.length > 0) {
                const bounds = ancestor.getBoundingClientRect();
                const viewportTop = bounds.top + scrollElement.clientTop;
                const delta = getRevealDelta(Math.min(...rects.map(rect => rect.top)),
                    Math.max(...rects.map(rect => rect.bottom)), viewportTop, viewportTop + scrollElement.clientHeight);
                if (delta !== 0) {
                    scrollElement.scrollTop += delta;
                }
            }
        }
        if (ancestor === scrollBoundary) {
            break;
        }
        ancestor = ancestor.parentElement;
    }
};

export const focusEditableAtGoalX = (element: Element, direction: TVerticalDirection, goalX: number,
                                     scrollBoundary?: Element) => {
    const target = resolveEditableVerticalNavigationTarget(element, direction, goalX, false);
    if (!target) {
        return false;
    }
    revealEditableVerticalNavigationTarget(target, scrollBoundary);
    const verifiedTarget = resolveEditableVerticalNavigationTarget(element, direction, goalX, true);
    if (!verifiedTarget) {
        return false;
    }
    focusByRange(verifiedTarget.range);
    return true;
};
