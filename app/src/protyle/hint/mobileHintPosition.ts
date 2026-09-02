export const getMobileHintPosition = (anchorTop: number, anchorBottom: number, hintHeight: number,
                                      viewportTop: number, viewportBottom: number, heightLimit = Infinity,
                                      gap = 0) => {
    const visibleAnchorTop = Math.max(viewportTop, Math.min(anchorTop, viewportBottom));
    const visibleAnchorBottom = Math.max(visibleAnchorTop, Math.min(anchorBottom, viewportBottom));
    const spaceAbove = Math.max(0, visibleAnchorTop - viewportTop - gap);
    const spaceBelow = Math.max(0, viewportBottom - visibleAnchorBottom - gap);
    const below = spaceBelow >= spaceAbove;
    const maxHeight = Math.min(below ? spaceBelow : spaceAbove, Math.max(0, heightLimit));
    const height = Math.min(hintHeight, maxHeight);
    return {
        maxHeight,
        top: below ? visibleAnchorBottom + gap : visibleAnchorTop - gap - height,
    };
};
