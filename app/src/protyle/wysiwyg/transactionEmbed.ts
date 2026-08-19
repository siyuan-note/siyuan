export const getMoveAffectedEmbedElements = (
    embedElements: Iterable<Element>,
    operation: Pick<IOperation, "id" | "blockIDs" | "parentID" | "previousID">,
    editingEmbedElement?: Element,
) => {
    const anchorIDs = [operation.id, operation.parentID, operation.previousID].filter(Boolean);
    const blockIDs = new Set(operation.blockIDs || []);
    if (anchorIDs.length === 0 && blockIDs.size === 0) {
        return [];
    }
    return Array.from(embedElements).filter(item => {
        if (item === editingEmbedElement) {
            return false;
        }
        if (anchorIDs.some(id => item.querySelector(`[data-node-id="${id}"]`))) {
            return true;
        }
        return blockIDs.size > 0 && Array.from(item.querySelectorAll("[data-node-id]"))
            .some(block => blockIDs.has(block.getAttribute("data-node-id")));
    });
};

export const shouldSyncMoveCopies = (isBacklink: boolean, isEmbedChildOperation: boolean) =>
    isBacklink || isEmbedChildOperation;
