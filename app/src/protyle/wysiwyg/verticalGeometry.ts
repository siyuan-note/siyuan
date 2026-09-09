import type {TVerticalDirection} from "./verticalCaret";

interface IVerticalRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
    width: number;
}

export const getRectsIntersectingVerticalLine = <T extends IVerticalRect>(rects: T[], lineRects: IVerticalRect[]) =>
    rects.filter(rect => lineRects.some(lineRect =>
        Math.min(rect.bottom, lineRect.bottom) - Math.max(rect.top, lineRect.top) > 0.5
    ));

export const getHorizontalDistanceToRect = (x: number, rect: IVerticalRect) => {
    if (x < rect.left) {
        return rect.left - x;
    }
    if (x > rect.right) {
        return x - rect.right;
    }
    return 0;
};

export const getRevealDelta = (targetStart: number, targetEnd: number, viewportStart: number,
                               viewportEnd: number) => {
    if (targetStart < viewportStart) {
        return targetStart - viewportStart;
    }
    if (targetEnd > viewportEnd) {
        return targetEnd - viewportEnd;
    }
    return 0;
};

export const getCodeTrailingZeroWidthLineLimit = (text: string) => {
    const trailingNewlineCount = text.match(/\n+$/)?.[0].length || 0;
    if (trailingNewlineCount === 0) {
        return;
    }
    const hasVisiblePrefix = text.substring(0, text.length - trailingNewlineCount).length > 0;
    return hasVisiblePrefix ? trailingNewlineCount - 1 : trailingNewlineCount;
};

export const getNavigableVerticalRects = <T extends IVerticalRect>(rects: T[],
                                                                   maxTrailingZeroWidthLines?: number) => {
    const navigableRects = rects.filter(rect => rect.height > 0.5);
    if (maxTrailingZeroWidthLines === undefined || navigableRects.length === 0) {
        return navigableRects;
    }
    const lineTops: number[] = [];
    navigableRects.forEach(rect => {
        if (!lineTops.some(top => Math.abs(rect.top - top) < 0.5)) {
            lineTops.push(rect.top);
        }
    });
    lineTops.sort((first, second) => first - second);
    const trailingZeroWidthLineTops: number[] = [];
    for (let index = lineTops.length - 1; index >= 0; index--) {
        const top = lineTops[index];
        const lineRects = navigableRects.filter(rect => Math.abs(rect.top - top) < 0.5);
        if (lineRects.some(rect => rect.width > 0.5)) {
            break;
        }
        trailingZeroWidthLineTops.push(top);
    }
    const removedLineTops = trailingZeroWidthLineTops.slice(0,
        Math.max(0, trailingZeroWidthLineTops.length - maxTrailingZeroWidthLines));
    return navigableRects.filter(rect => !removedLineTops.some(top => Math.abs(rect.top - top) < 0.5));
};

export const isCaretRectAtVerticalBoundary = (caretTop: number, rects: IVerticalRect[],
                                               direction: TVerticalDirection) => {
    if (rects.length === 0) {
        return true;
    }
    const lineHeight = Math.min(...rects.map(rect => rect.height));
    const tolerance = Math.max(2, lineHeight / 2);
    const boundaryTop = direction === "up" ?
        Math.min(...rects.map(rect => rect.top)) : Math.max(...rects.map(rect => rect.top));
    return Math.abs(caretTop - boundaryTop) <= tolerance;
};
