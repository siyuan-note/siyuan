export const shouldFocusJumpTarget = (options: {
    isRoot: boolean,
    showAll: boolean,
    isFolded: boolean,
    isHidden: boolean,
}) => !options.isRoot && (options.showAll || (options.isFolded && options.isHidden));
