import type {RectBounds} from "./rectAnnotationResize";

export const isPdfRectAnnotation = (mode: string, rectCount: number, content: string) => mode === "rect" ||
    (!mode && rectCount === 1 && /-P\d+-\d{14}-\w{7}$/.test(content));

const contains = (outer: RectBounds, inner: RectBounds) => outer.left <= inner.left &&
    outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;

const canMerge = (a: RectBounds, b: RectBounds) => {
    if (contains(a, b) || contains(b, a)) {
        return true;
    }
    const minHeight = Math.min(a.bottom - a.top, b.bottom - b.top);
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const centerDistance = Math.abs((a.top + a.bottom) - (b.top + b.bottom)) / 2;
    // 用文字高度判断同一行，避免缩放改变合并结果；保留行间和分栏中的空白。
    // 同行片段间允许四分之一文字高度的排版间距，避免在字间留下内部边框。
    return overlap >= minHeight * 0.8 && centerDistance <= minHeight * 0.25 &&
        Math.max(a.left, b.left) <= Math.min(a.right, b.right) + minHeight * 0.25;
};

export const mergeTextAnnotationRects = (rects: readonly RectBounds[]): RectBounds[] => {
    const result: RectBounds[] = [];
    rects.forEach(rect => {
        if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ||
            rect.right <= rect.left || rect.bottom <= rect.top) {
            return;
        }
        let merged = {...rect};
        let insertAt = result.length;
        for (let i = 0; i < result.length;) {
            const previous = result[i];
            if (!canMerge(previous, merged)) {
                i++;
                continue;
            }
            merged = {
                left: Math.min(previous.left, merged.left),
                top: Math.min(previous.top, merged.top),
                right: Math.max(previous.right, merged.right),
                bottom: Math.max(previous.bottom, merged.bottom),
            };
            insertAt = Math.min(insertAt, i);
            result.splice(i, 1);
            // 合并后的边界可能包含前面的矩形，重新检查并保留原有选区顺序。
            i = 0;
        }
        result.splice(insertAt, 0, merged);
    });
    return result;
};

export const mergePdfTextAnnotationRects = (coords: readonly number[][]): number[][] =>
    mergeTextAnnotationRects(coords.map(rect => ({
        left: Math.min(rect[0], rect[2]),
        top: Math.min(rect[1], rect[3]),
        right: Math.max(rect[0], rect[2]),
        bottom: Math.max(rect[1], rect[3]),
    }))).map(rect => [rect.left, rect.top, rect.right, rect.bottom]);
