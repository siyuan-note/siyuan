interface IStartScrollOverlay {
    absolute: boolean;
    offsetParentTop: number;
    offsetTop: number;
    height: number;
}

export const getStartScrollTop = (options: {
    scrollTop: number;
    elementTop: number;
    contentTop: number;
    contextHeight: number;
    overlay?: IStartScrollOverlay;
}) => {
    let visibleTop = options.contentTop;
    if (options.overlay?.absolute) {
        visibleTop = Math.max(visibleTop,
            options.overlay.offsetParentTop + options.overlay.offsetTop + options.overlay.height);
    }
    return options.scrollTop + options.elementTop - visibleTop - options.contextHeight;
};
