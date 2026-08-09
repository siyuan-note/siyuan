export const isDocumentBlockCountCovered = (requestSize: number, blockCount?: number) =>
    typeof blockCount === "number" && requestSize >= blockCount;

export const loadUntilDocumentBoundary = async (options: {
    isCurrent: () => boolean,
    isBoundaryLoaded: () => boolean,
    getBoundaryID: () => string | null | undefined,
    load: () => Promise<boolean>,
}) => {
    while (options.isCurrent() && !options.isBoundaryLoaded()) {
        const boundaryID = options.getBoundaryID();
        if (!await options.load()) {
            return false;
        }
        if (!options.isCurrent()) {
            return false;
        }
        if (options.isBoundaryLoaded()) {
            return true;
        }
        if (!boundaryID || options.getBoundaryID() === boundaryID) {
            return false;
        }
    }
    return options.isCurrent() && options.isBoundaryLoaded();
};
