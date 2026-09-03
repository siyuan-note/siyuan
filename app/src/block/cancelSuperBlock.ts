type TCancelSuperBlockOperationOptions = {
    id: string,
    data: string,
    childIDs: string[],
    foldedHeadingIDs: string[],
    previousID?: string,
    parentID?: string,
};

export interface ISuperBlockChildReplacement {
    childIDs: string[];
    foldedHeadingIDs: string[];
}

export const resolveCancelSuperBlockChildren = (
    children: Array<{id: string, folded: boolean}>,
    excludedChildIDs?: Set<string>,
    childReplacements?: Map<string, ISuperBlockChildReplacement>
) => {
    const childIDs: string[] = [];
    const foldedHeadingIDs: string[] = [];
    children.forEach(child => {
        if (excludedChildIDs?.has(child.id)) {
            return;
        }
        const replacement = childReplacements?.get(child.id);
        if (replacement) {
            replacement.childIDs.forEach(id => {
                if (!excludedChildIDs?.has(id)) {
                    childIDs.push(id);
                }
            });
            replacement.foldedHeadingIDs.forEach(id => {
                if (!excludedChildIDs?.has(id)) {
                    foldedHeadingIDs.push(id);
                }
            });
        } else {
            childIDs.push(child.id);
            if (child.folded) {
                foldedHeadingIDs.push(child.id);
            }
        }
    });
    return {childIDs, foldedHeadingIDs};
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

export const appendCancelSuperBlockOperations = (
    doOperations: IOperation[], undoOperations: IOperation[],
    cancelOperations: {doOperations: IOperation[], undoOperations: IOperation[]}
) => {
    doOperations.push(...cancelOperations.doOperations);
    // moveTo 会在返回前反转撤销数组，因此这里先按相反顺序压入。
    undoOperations.push(...[...cancelOperations.undoOperations].reverse());
};
