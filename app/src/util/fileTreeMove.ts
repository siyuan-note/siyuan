export interface IFileTreeMove {
    fromNotebook: string;
    fromPath: string;
    toNotebook: string;
    toPath: string;
    newPath: string;
}

export interface IDocumentTabDragData {
    rootId: string;
    tabId: string;
    title: string;
}

export interface IDocumentTreeDragData {
    ids: string[];
}

const BLOCK_ID_PATTERN = /^\d{14}-[0-9a-z]{7}$/;

export const getRelativeReorderRequest = (sourceIDs: string[], targetID: string, insertAfter: boolean) => ({
    sourceIDs,
    targetID,
    position: insertAfter ? "after" as const : "before" as const,
});

export const parseDocumentTabDragData = (data: string) => {
    try {
        const result = JSON.parse(data) as IDocumentTabDragData;
        if (!BLOCK_ID_PATTERN.test(result.rootId) || typeof result.tabId !== "string" ||
            typeof result.title !== "string") {
            return;
        }
        return result;
    } catch (e) {
        console.warn("parse document tab drop data failed", e);
    }
};

export const parseDocumentTreeDragData = (data: string) => {
    try {
        const result = JSON.parse(data) as IDocumentTreeDragData;
        if (!Array.isArray(result.ids) || result.ids.length === 0 ||
            result.ids.some((id) => typeof id !== "string" || !BLOCK_ID_PATTERN.test(id))) {
            return;
        }
        return {
            ids: Array.from(new Set(result.ids)),
        };
    } catch (e) {
        console.warn("parse document tree drop data failed", e);
    }
};
