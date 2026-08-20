export const shouldFocusJumpTarget = (options: {
    isRoot: boolean,
    showAll: boolean,
    isFolded: boolean,
    isHidden: boolean,
}) => !options.isRoot && (options.showAll || (options.isFolded && options.isHidden));

export const shouldFocusParentDocumentTitle = (options: {
    isRoot: boolean,
    hasTitle: boolean,
    isBacklink: boolean,
}) => options.isRoot && options.hasTitle && !options.isBacklink;
