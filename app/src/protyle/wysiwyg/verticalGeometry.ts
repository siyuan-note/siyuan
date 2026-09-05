import type {TVerticalDirection} from "./verticalCaret";

interface IVerticalRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
    height: number;
    width: number;
}

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
