interface ISelectionElementPositionOptions {
    elementHeight: number;
    rangeTop: number;
    rangeBottom: number;
    topBoundary: number;
    bottomBoundary: number;
    gap: number;
    isBottom: boolean;
    toolbarTop?: number;
    toolbarBottom?: number;
}

export const getSelectionElementAvailableHeight = (options: ISelectionElementPositionOptions) => {
    const toolbarAbove = typeof options.toolbarBottom === "number" && options.toolbarBottom <= options.rangeTop;
    const toolbarBelow = typeof options.toolbarTop === "number" && options.toolbarTop >= options.rangeBottom;
    const top = toolbarAbove ? options.toolbarTop : options.rangeTop;
    const bottom = toolbarBelow ? options.toolbarBottom : options.rangeBottom;
    return Math.max(
        top - options.topBoundary - options.gap,
        options.bottomBoundary - bottom - options.gap,
        0
    );
};

export const getSelectionElementY = (options: ISelectionElementPositionOptions) => {
    const aboveRange = options.rangeTop - options.elementHeight - options.gap;
    const belowRange = options.rangeBottom + options.gap;
    if (typeof options.toolbarTop === "number" && typeof options.toolbarBottom === "number") {
        if (options.toolbarBottom <= options.rangeTop) {
            const aboveToolbar = options.toolbarTop - options.elementHeight - options.gap;
            return aboveToolbar >= options.topBoundary ?
                aboveToolbar : Math.min(belowRange, options.bottomBoundary - options.elementHeight);
        }
        if (options.toolbarTop >= options.rangeBottom) {
            const belowToolbar = options.toolbarBottom + options.gap;
            return belowToolbar + options.elementHeight <= options.bottomBoundary ?
                belowToolbar : Math.max(aboveRange, options.topBoundary);
        }
    }
    return options.isBottom ?
        (belowRange + options.elementHeight <= options.bottomBoundary ?
            belowRange : Math.max(aboveRange, options.topBoundary)) :
        (aboveRange >= options.topBoundary ?
            aboveRange : Math.min(belowRange, options.bottomBoundary - options.elementHeight));
};
