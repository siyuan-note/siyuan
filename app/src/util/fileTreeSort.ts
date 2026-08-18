import type {IFileTreeMove} from "./fileTreeMove";

export const FILE_TREE_EFFECTIVE_SORT_MODE = "data-effective-sort-mode";
export const FILE_TREE_CHILDREN_SORT_MODE = "data-children-sort-mode";

export interface IDocSortModeChanged {
    scope: "document" | "notebook" | "global";
    box: string;
    id: string;
    path: string;
    sortMode: number | null;
}

export interface IFileTreeSortRefreshTarget {
    notebookId: string;
    path: string;
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

const findElement = (element: Element, match: (item: Element) => boolean): Element | undefined => {
    for (const child of Array.from(element?.children || [])) {
        if (match(child)) {
            return child;
        }
        const result = findElement(child, match);
        if (result) {
            return result;
        }
    }
};

const getNotebookElements = (element: Element) => Array.from(element?.children || []).filter((item) =>
    item.tagName === "UL" && Boolean(item.getAttribute("data-url"))
);

const getChildListElement = (element: Element) => {
    const listElement = element?.nextElementSibling;
    return listElement?.tagName === "UL" ? listElement : undefined;
};

const addInheritedRefreshTargets = (parentElement: Element, notebookId: string,
                                    targets: Map<string, IFileTreeSortRefreshTarget>) => {
    const listElement = getChildListElement(parentElement);
    const path = parentElement?.getAttribute("data-path");
    if (!listElement || !path) {
        return;
    }
    targets.set(`${notebookId}:${path}`, {notebookId, path});
    Array.from(listElement.children).forEach((item) => {
        if (item.tagName !== "LI" || item.getAttribute("data-type") !== "navigation-file" ||
            getConfiguredChildrenSortMode(item) !== null) {
            return;
        }
        addInheritedRefreshTargets(item, notebookId, targets);
    });
};

const getPathParent = (filePath: string) => {
    const separatorIndex = filePath.lastIndexOf("/");
    return separatorIndex <= 0 ? "/" : filePath.slice(0, separatorIndex);
};

export const getMovedFileTreeSortRefreshTargets = (element: Element, moves: IFileTreeMove[]) => {
    const targets = new Map<string, IFileTreeSortRefreshTarget>();
    moves.forEach((move) => {
        if (move.fromNotebook === move.toNotebook &&
            getPathParent(move.fromPath) === getPathParent(move.newPath)) {
            return;
        }
        const notebookElement = getNotebookElements(element).find((item) =>
            item.getAttribute("data-url") === move.toNotebook
        );
        const documentElement = findElement(notebookElement, (item) =>
            item.tagName === "LI" && item.getAttribute("data-path") === move.newPath
        );
        if (!documentElement || getConfiguredChildrenSortMode(documentElement) !== null) {
            return;
        }
        addInheritedRefreshTargets(documentElement, move.toNotebook, targets);
    });
    return Array.from(targets.values());
};

export const getFileTreeSortRefreshTargets = (element: Element, changes: IDocSortModeChanged[]) => {
    const targets = new Map<string, IFileTreeSortRefreshTarget>();
    changes.forEach((change) => {
        if (change.scope === "global") {
            getNotebookElements(element).forEach((notebookElement) => {
                if (parseSortMode(notebookElement.getAttribute("data-sortmode")) !== 15) {
                    return;
                }
                addInheritedRefreshTargets(notebookElement.firstElementChild, notebookElement.getAttribute("data-url"),
                    targets);
            });
            return;
        }
        const notebookElement = getNotebookElements(element).find((item) =>
            item.getAttribute("data-url") === change.box
        );
        if (!notebookElement) {
            return;
        }
        if (change.scope === "notebook") {
            addInheritedRefreshTargets(notebookElement.firstElementChild, change.box, targets);
            return;
        }
        const documentElement = findElement(notebookElement, (item) =>
            item.tagName === "LI" && item.getAttribute("data-node-id") === change.id
        );
        if (documentElement) {
            addInheritedRefreshTargets(documentElement, change.box, targets);
        }
    });
    return Array.from(targets.values());
};

export const reorderFileTreeNotebooks = (element: Element, closedListElement: Element,
                                         notebooks: Array<Pick<INotebook, "id" | "closed">>) => {
    const openedElements = new Map(getNotebookElements(element).map((item) => [item.getAttribute("data-url"), item]));
    const closedElements = new Map(Array.from(closedListElement?.children || []).map((item) =>
        [item.getAttribute("data-url"), item]
    ));
    notebooks.forEach((notebook) => {
        const notebookElement = notebook.closed ? closedElements.get(notebook.id) : openedElements.get(notebook.id);
        if (notebookElement) {
            (notebook.closed ? closedListElement : element).append(notebookElement);
        }
    });
};

export const updateFileTreeSortMode = (data?: IDocSortModeChanged, element?: Element) => {
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
        getNotebookElements(element).find((item) => item.getAttribute("data-url") === data.box)?.setAttribute(
            "data-sortmode", sortMode.toString()
        );
    } else {
        const notebookElement = getNotebookElements(element).find((item) => item.getAttribute("data-url") === data.box);
        findElement(notebookElement, (item) =>
            item.tagName === "LI" && item.getAttribute("data-node-id") === data.id
        )?.setAttribute(FILE_TREE_CHILDREN_SORT_MODE, sortMode?.toString() || "");
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
