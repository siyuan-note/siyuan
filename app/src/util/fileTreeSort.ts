export const FILE_TREE_EFFECTIVE_SORT_MODE = "data-effective-sort-mode";
export const FILE_TREE_CHILDREN_SORT_MODE = "data-children-sort-mode";

export interface IDocSortModeChanged {
    scope: "document" | "notebook" | "global";
    box: string;
    id: string;
    path: string;
    sortMode: number | null;
}

const parseSortMode = (value: string | null) => {
    if (value === null || value.trim() === "") {
        return;
    }
    const sortMode = Number(value);
    return Number.isInteger(sortMode) ? sortMode : undefined;
};

export const getConfiguredChildrenSortMode = (element: Element) => {
    return parseSortMode(element?.getAttribute(FILE_TREE_CHILDREN_SORT_MODE)) ?? null;
};

export const getFileTreeListSortMode = (element: Element) => {
    const effectiveSortMode = parseSortMode(element?.getAttribute(FILE_TREE_EFFECTIVE_SORT_MODE));
    if (typeof effectiveSortMode === "number") {
        return effectiveSortMode;
    }

    const notebookElement = element?.closest("ul[data-url][data-sortmode]");
    const notebookSortMode = parseSortMode(notebookElement?.getAttribute("data-sortmode"));
    return notebookSortMode === 15 || typeof notebookSortMode !== "number" ?
        window.siyuan.config.fileTree.sort : notebookSortMode;
};

export const isCustomFileTreeList = (element: Element) => getFileTreeListSortMode(element) === 6;

export const updateFileTreeSortMode = (data?: IDocSortModeChanged) => {
    const sortMode = data?.sortMode;
    if (typeof sortMode !== "number" || !Number.isInteger(sortMode)) {
        return;
    }
    if (data.scope === "global") {
        window.siyuan.config.fileTree.sort = sortMode;
    } else if (data.scope === "notebook") {
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
