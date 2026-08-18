type TCancelSuperBlockOperationOptions = {
    id: string,
    data: string,
    childIDs: string[],
    foldedHeadingIDs: string[],
    previousID?: string,
    parentID?: string,
};

const genFoldOperations = (headingIDs: string[], action: "foldHeading" | "unfoldHeading") => {
    return headingIDs.map(id => ({action, id}) as IOperation);
};

const genMoveOperations = (childIDs: string[], previousID: string | undefined, parentID: string | undefined) => {
    return childIDs.map(id => {
        const operation: IOperation = {
            action: "move",
            id,
            previousID,
            parentID,
        };
        previousID = id;
        return operation;
    });
};

export const buildCancelSuperBlockOperations = (options: TCancelSuperBlockOperationOptions) => {
    const foldedHeadingIDs = options.foldedHeadingIDs;
    const reversedFoldedHeadingIDs = [...foldedHeadingIDs].reverse();
    const doOperations = [
        ...genFoldOperations(foldedHeadingIDs, "unfoldHeading"),
        ...genMoveOperations(options.childIDs, options.previousID, options.parentID),
        {action: "delete", id: options.id} as IOperation,
        ...genFoldOperations(reversedFoldedHeadingIDs, "foldHeading"),
    ];
    const undoOperations = [
        ...genFoldOperations(foldedHeadingIDs, "unfoldHeading"),
        {
            action: "insert",
            id: options.id,
            data: options.data,
            previousID: options.previousID,
            parentID: options.parentID,
        } as IOperation,
        ...genMoveOperations(options.childIDs, undefined, options.id),
        ...genFoldOperations(reversedFoldedHeadingIDs, "foldHeading"),
    ];
    return {doOperations, undoOperations};
};
