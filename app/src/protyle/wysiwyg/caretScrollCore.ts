export type TCaretVerticalDirection = "up" | "down";

export interface ICaretScrollGeometry {
    caretTop: number;
    caretHeight: number;
    viewportTop: number;
    viewportHeight: number;
    lineHeight: number;
    surroundingLines: number;
}

export const getCaretOverflowDirection = (geometry: Pick<ICaretScrollGeometry,
    "caretTop" | "caretHeight" | "viewportTop" | "viewportHeight">): TCaretVerticalDirection | undefined => {
    if (geometry.viewportHeight <= 0 || !Number.isFinite(geometry.caretTop) ||
        !Number.isFinite(geometry.viewportTop)) {
        return;
    }
    if (geometry.caretTop < geometry.viewportTop) {
        return "up";
    }
    const caretBottom = geometry.caretTop + Math.max(0, geometry.caretHeight);
    if (caretBottom > geometry.viewportTop + geometry.viewportHeight) {
        return "down";
    }
};

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
