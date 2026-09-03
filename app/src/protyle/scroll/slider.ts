export const getScrollIndexFromPointer = (
    clientY: number,
    rect: Pick<DOMRect, "top" | "height">,
    min: number,
    max: number,
) => {
    if (max <= min || rect.height <= 0) {
        return min;
    }
    const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    return Math.round(min + (max - min) * ratio);
};
