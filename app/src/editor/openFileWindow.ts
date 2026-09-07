export const shouldCheckOtherWindows = (options: {
    position?: string,
    assetPath?: string,
    forceCurrentWindow?: boolean,
}) => {
    return !options.forceCurrentWindow &&
        (!options.position || (options.position === "right" && Boolean(options.assetPath)));
};
