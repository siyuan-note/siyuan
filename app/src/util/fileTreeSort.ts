import {getDocTreeItem} from "../layout/dock/docTree/rowData";

export interface IDocSortModeChanged {
    scope: "document" | "notebook" | "global";
    box: string;
    id: string;
    path: string;
    sortMode: number | null;
}

export const getConfiguredChildrenSortMode = (element: Element) => getDocTreeItem(element)?.childrenSortMode ?? null;

export const getFileTreeListSortMode = (element: Element) => getDocTreeItem(element)?.effectiveSortMode ?? window.siyuan.config.fileTree.sort;

export const isCustomFileTreeList = (element: Element) => getFileTreeListSortMode(element) === 6;

export const updateFileTreeSortMode = (data?: IDocSortModeChanged) => {
    const sortMode = data?.sortMode;
    if (!data || (sortMode !== null && (typeof sortMode !== "number" || !Number.isInteger(sortMode)))) {
        return;
    }
    if (data.scope === "global") {
        if (sortMode === null) {
            return;
        }
        window.siyuan.config.fileTree.sort = sortMode;
    } else if (data.scope === "notebook") {
        if (sortMode === null) {
            return;
        }
        const notebook = window.siyuan.notebooks.find((item) => item.id === data.box);
        if (notebook) {
            notebook.sortMode = sortMode;
        }
    }

};

export const getResponseEffectiveSortMode = (data: IFileTreeList, notebookId: string) => {
    if (Number.isInteger(data.effectiveSortMode)) {
        return data.effectiveSortMode;
    }

    const notebookSortMode = window.siyuan.notebooks.find((item) => item.id === notebookId)?.sortMode;
    return notebookSortMode === 15 || typeof notebookSortMode !== "number" ?
        window.siyuan.config.fileTree.sort : notebookSortMode;
};
