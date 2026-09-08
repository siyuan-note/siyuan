import {focusByRange, setFirstNodeRange, setLastNodeRange} from "../util/selection";
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

// 缺少光标矩形时，优先测量偏移之后的字符，避免把换行后的空行解释成前一行。
const getRangeContextRects = (range: Range, contextElement: Element) => {
    const rangeRects = Array.from(range.getClientRects()).filter(rect => rect.height > 0.5);
    if (rangeRects.length > 0) {
        return [rangeRects[range.collapsed ? rangeRects.length - 1 : 0]];
    }
    for (const forward of [true, false]) {
        const adjacent = (node: Node): Node | null => {
            while (node && node !== contextElement) {
                const sibling = forward ? node.nextSibling : node.previousSibling;
                if (sibling) {
                    return sibling;
                }
                node = node.parentNode;
            }
            return null;
        };
        let node: Node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) {
            node = node.childNodes[range.startOffset - (forward ? 0 : 1)] || adjacent(node);
        }
        while (node && contextElement.contains(node)) {
            const probeRange = contextElement.ownerDocument.createRange();
            if (node.nodeType === Node.TEXT_NODE) {
                const offset = node === range.startContainer ? range.startOffset :
                    forward ? 0 : node.textContent.length;
                const start = forward ? offset : Math.max(0, offset - 1);
                const end = forward ? Math.min(node.textContent.length, offset + 1) : offset;
                if (start === end) {
                    node = adjacent(node);
                    continue;
                }
                probeRange.setStart(node, start);
                probeRange.setEnd(node, end);
            } else if (node.nodeType === Node.ELEMENT_NODE && node.hasChildNodes() &&
                !(node as Element).matches(".render-node, [contenteditable=\"false\"]")) {
                node = forward ? node.firstChild : node.lastChild;
                continue;
            } else {
                probeRange.selectNode(node);
            }
            const rects = Array.from(probeRange.getClientRects()).filter(rect => rect.height > 0.5);
            const rect = rects[forward ? 0 : rects.length - 1];
            if (rect) {
                return [new DOMRect(forward ? rect.left : rect.right, rect.top, 0, rect.height)];
            }
            node = adjacent(node);
        }
    }
    return contextElement.textContent || contextElement.querySelector("img, .render-node") ? [] :
        Array.from(contextElement.getClientRects());
};

const getRangeRectsOnLine = (element: Element, range: Range, lineRects: DOMRect[], requireVisible = false) => {
    const contextElement = getRangeContextElement(range);
    if (!contextElement || !element.contains(contextElement)) {
        return [];
    }
    return getRectsIntersectingVerticalLine(
        getReachableVerticalRects(contextElement, getRangeContextRects(range, element), requireVisible), lineRects);
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
    const rects = getRangeContextRects(range, element);
    return rects.length > 0 && isCaretRectAtVerticalBoundary(rects[0].top, getContentRects(element), direction);
};

export const getCaretGoalX = (range: Range, fallbackElement?: Element) => {
    const contextElement = getRangeContextElement(range);
    const editable = contextElement?.closest("[contenteditable=\"true\"]");
    const rect = contextElement && getRangeContextRects(range, editable || contextElement)[0];
    if (rect && Number.isFinite(rect.left)) {
        return rect.left;
    }
    if (fallbackElement) {
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
    if (!element.isConnected || getFoldedNavigationOwner(element) ||
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
        let pointRange = document.caretRangeFromPoint(x, (lineTop + lineBottom) / 2);
        for (let attempt = 0; pointRange && attempt < 2; attempt++) {
            const pointRangeRects = getRangeRectsOnLine(element, pointRange, lineRects, requireHit);
            if (element.contains(pointRange.startContainer) && pointRangeRects.length > 0 &&
                (!requireHit || isCaretHitReachable(element, pointRangeRects))) {
                pointRange.collapse(true);
                return {element, direction, range: pointRange};
            }
            // 自动折行处可能同时带有前后两行矩形，改用前一字形的另一侧建立明确的行内位置。
            if (attempt > 0 || pointRangeRects.length > 0 || pointRange.getClientRects().length < 2 ||
                !element.contains(pointRange.startContainer) ||
                pointRange.startContainer.nodeType !== Node.TEXT_NODE || pointRange.startOffset === 0) {
                break;
            }
            const probeRange = pointRange.cloneRange();
            probeRange.setStart(pointRange.startContainer, pointRange.startOffset - 1);
            const rect = getRectsIntersectingVerticalLine(Array.from(probeRange.getClientRects()), lineRects)
                .find(item => item.width > 0.5);
            if (!rect) {
                break;
            }
            const probeX = Math.abs(rect.left - x) > Math.abs(rect.right - x) ? rect.left + 0.25 : rect.right - 0.25;
            pointRange = document.caretRangeFromPoint(probeX, (rect.top + rect.bottom) / 2);
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
        reachableRects = lineRects.length > 0 ? getRangeRectsOnLine(element, range, lineRects, requireHit) :
            getReachableVerticalRects(element, caretRects, requireHit);
        if (reachableRects.length === 0) {
            return;
        }
    } else if (lineRects.length > 0) {
        reachableRects = getRangeRectsOnLine(element, range, lineRects, requireHit);
        if (reachableRects.length === 0) {
            return;
        }
    } else if (element.textContent || element.querySelector("img, .render-node")) {
        return;
    } else {
        reachableRects = getReachableVerticalRects(element, Array.from(element.getClientRects()), requireHit);
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
            getRangeContextRects(target.range, target.element));
        if (contextRects.length > 0) {
            return contextRects;
        }
    }
    return getReachableVerticalRects(target.element, Array.from(target.element.getClientRects()));
};

const revealEditableVerticalNavigationTarget = (target: IEditableVerticalNavigationTarget,
                                                goalX: number, boundaryElement?: Element) => {
    const closestBlock = target.element.closest("[data-node-id]");
    const scrollBoundary = boundaryElement?.contains(target.element) ? boundaryElement : closestBlock || target.element;
    let ancestor: Element | null = target.element;
    while (ancestor) {
        const scrollElement = ancestor as HTMLElement;
        const view = ancestor.ownerDocument.defaultView;
        const style = view?.getComputedStyle(ancestor);
        const canScrollX = scrollElement.scrollWidth > scrollElement.clientWidth + 1 &&
            ["auto", "scroll", "overlay"].includes(style?.overflowX);
        const canScrollY = scrollElement.scrollHeight > scrollElement.clientHeight + 1 &&
            (ancestor === scrollBoundary || ["auto", "scroll", "overlay"].includes(style?.overflowY));
        if (canScrollX || canScrollY) {
            const rects = getEditableTargetRects(target);
            if (rects.length > 0) {
                const bounds = ancestor.getBoundingClientRect();
                if (canScrollX) {
                    const viewportLeft = bounds.left + scrollElement.clientLeft;
                    const lineLeft = Math.min(...rects.map(rect => rect.left));
                    const lineRight = Math.max(...rects.map(rect => rect.right));
                    const x = Math.max(lineLeft, Math.min(goalX, lineRight));
                    const fitsLine = lineRight - lineLeft + 2 <= scrollElement.clientWidth;
                    scrollElement.scrollLeft += getRevealDelta(fitsLine ? lineLeft - 1 : x - 1,
                        fitsLine ? lineRight + 1 : x + 1, viewportLeft, viewportLeft + scrollElement.clientWidth);
                }
                if (canScrollY) {
                    const viewportTop = bounds.top + scrollElement.clientTop;
                    scrollElement.scrollTop += getRevealDelta(Math.min(...rects.map(rect => rect.top)),
                        Math.max(...rects.map(rect => rect.bottom)), viewportTop, viewportTop + scrollElement.clientHeight);
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
    const parentElement = element.parentElement;
    revealEditableVerticalNavigationTarget(target, goalX, scrollBoundary);
    if (!element.isConnected || element.parentElement !== parentElement || !element.contains(target.range.startContainer)) {
        return false;
    }
    const verifiedTarget = resolveEditableVerticalNavigationTarget(element, direction, goalX, true);
    if (!verifiedTarget) {
        return false;
    }
    focusByRange(verifiedTarget.range);
    return true;
};
