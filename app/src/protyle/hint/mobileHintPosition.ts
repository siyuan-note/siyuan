export const getMobileHintPosition = (anchorTop: number, hintHeight: number, viewportTop: number,
                                      viewportBottom: number, heightLimit = Infinity, gap = 0) => {
    const visibleAnchorTop = Math.max(viewportTop, Math.min(anchorTop, viewportBottom));
    const maxHeight = Math.min(Math.max(0, visibleAnchorTop - viewportTop - gap), Math.max(0, heightLimit));
    const height = Math.min(hintHeight, maxHeight);
    return {
        maxHeight,
        top: visibleAnchorTop - gap - height,
    };
};
