export const getMoveAffectedEmbedElements = (
    embedElements: Iterable<Element>,
    operation: Pick<IOperation, "id" | "parentID" | "previousID">,
    editingEmbedElement?: Element,
) => {
    const ids = [operation.id, operation.parentID, operation.previousID].filter(Boolean);
    if (ids.length === 0) {
        return [];
    }
    const selector = ids.map(id => `[data-node-id="${id}"]`).join(",");
    return Array.from(embedElements).filter(item =>
        item !== editingEmbedElement && !!item.querySelector(selector));
};

export const shouldSyncMoveCopies = (isBacklink: boolean, isEmbedChildOperation: boolean) =>
    isBacklink || isEmbedChildOperation;
