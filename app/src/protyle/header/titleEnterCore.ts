export type TTitleEnterAction = "load" | "focus" | "insert";

export const getTitleEnterAction = (options: {
    documentStartLoaded: boolean,
    hasFirstBlock: boolean,
    firstBlockIsList: boolean,
    firstEditableIsEmpty: boolean,
    firstEditableHasPlaceholder: boolean,
}): TTitleEnterAction => {
    if (!options.documentStartLoaded || !options.hasFirstBlock) {
        return "load";
    }
    if (options.firstBlockIsList ||
        (options.firstEditableIsEmpty && options.firstEditableHasPlaceholder)) {
        return "focus";
    }
    return "insert";
};
