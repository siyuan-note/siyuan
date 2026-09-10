export const getAnchoredMenuPosition = (bottom: number, targetHeight: number, menuHeight: number,
                                       viewportHeight: number, topBarHeight: number) => {
    const below = Math.max(0, viewportHeight - bottom);
    const above = Math.max(0, bottom - targetHeight - topBarHeight);
    const openAbove = menuHeight > below && (menuHeight <= above || above > below);
    const height = Math.min(menuHeight, openAbove ? above : below);
    return {
        top: openAbove ? bottom - targetHeight - height : bottom,
        height,
    };
};
