export type TCaretVerticalDirection = "up" | "down";

interface ICaretScrollGeometry {
    caretTop: number;
    caretHeight: number;
    viewportTop: number;
    viewportHeight: number;
    lineHeight: number;
    surroundingLines: number;
}

export const getCaretScrollDelta = (geometry: ICaretScrollGeometry, direction: TCaretVerticalDirection) => {
    if (geometry.surroundingLines <= 0 || geometry.viewportHeight <= 0 || geometry.lineHeight <= 0) {
        return 0;
    }
    const caretHeight = Math.max(0, geometry.caretHeight);
    const maximumMargin = Math.max(0, (geometry.viewportHeight - caretHeight) / 2);
    const margin = Math.min(geometry.surroundingLines * geometry.lineHeight, maximumMargin);
    if (direction === "up") {
        const minimumCaretTop = geometry.viewportTop + margin;
        return geometry.caretTop < minimumCaretTop ? geometry.caretTop - minimumCaretTop : 0;
    }
    const maximumCaretBottom = geometry.viewportTop + geometry.viewportHeight - margin;
    const caretBottom = geometry.caretTop + caretHeight;
    return caretBottom > maximumCaretBottom ? caretBottom - maximumCaretBottom : 0;
};
