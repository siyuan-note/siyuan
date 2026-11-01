import type {IDocTreeItem} from "./types";

const rows = new WeakMap<Element, IDocTreeItem>();

export const notebookTreeItem = (notebook: INotebook): IDocTreeItem => ({
    id: notebook.id, notebookId: notebook.id, path: "/", name: notebook.name, kind: "notebook",
    subFileCount: notebook.subFileCount || 0, notebook, occurrenceKey: `notebook:${notebook.id}`,
    parentID: "", childrenSortMode: null, effectiveSortMode: notebook.sortMode,
    depth: 0, index: 0, setSize: -1,
});

export const setDocTreeRowItem = (row: Element, item: IDocTreeItem) => rows.set(row, item);

// Row DOM carries identity only. Business data belongs to the current projection.
export const getDocTreeItem = (element?: Element | null): IDocTreeItem | undefined => {
    const row = element?.closest("li[data-tree-key]");
    if (!row) { return; }
    const item = rows.get(row);
    if (item) { return item; }
    const key = row.getAttribute("data-tree-key");
    if (!key?.startsWith("notebook:")) { return; }
    const notebook = window.siyuan.notebooks.find(value => `notebook:${value.id}` === key && value.closed);
    return notebook ? notebookTreeItem(notebook) : undefined;
};

export const isEncryptedDocTreeItem = (element?: Element | null) => {
    const item = getDocTreeItem(element);
    return Boolean(item && window.siyuan.notebooks.find(notebook => notebook.id === item.notebookId)?.encrypted);
};

export const setDocTreeAttribute = (row: Element, name: string, value?: string) => {
    if (value === undefined) {
        if (row.hasAttribute(name)) { row.removeAttribute(name); }
    } else if (row.getAttribute(name) !== value) {
        row.setAttribute(name, value);
    }
};
