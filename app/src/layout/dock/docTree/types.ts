export interface IDocTreeRoot {
    id: string;
    notebookId: string;
    path: string;
    name: string;
    kind: "document" | "notebook";
    subFileCount: number;
    occurrenceKey?: string;
    childrenSortMode?: number | null;
    effectiveSortMode?: number;
    unavailable?: boolean;
    file?: IFile;
    notebook?: INotebook;
}

export interface IDocTreeItem extends IDocTreeRoot {
    occurrenceKey: string;
    parentID: string;
    parentKey?: string;
    childrenSortMode: number | null;
    effectiveSortMode: number;
    depth: number;
    index: number;
    setSize: number;
}

export interface IDocTreeRange {
    box: string;
    parentID: string;
    path: string;
    files: IFile[];
    total: number;
    offset: number;
    limit: number;
    effectiveSortMode: number;
    revision: string;
    stale: boolean;
}

export interface IDocTreeLocateStep {
    parentID: string;
    path: string;
    id: string;
    index: number;
    total: number;
    effectiveSortMode: number;
    revision: string;
}

export interface IDocTreeDataSource {
    range(request: {notebook: string, parentID: string, offset: number, limit: number, revision?: string}): Promise<IDocTreeRange>;
    locate(request: {notebook: string, id: string}): Promise<{box: string, id: string, steps: IDocTreeLocateStep[]}>;
}

export interface IDocTreeExpansion {
    occurrenceKey: string;
    notebookId: string;
    id: string;
    path: string;
    kind: "document" | "notebook";
}

export interface IDocTreeSelectOptions {
    toggle?: boolean;
    range?: boolean;
    scroll?: boolean;
}

export const docTreeDirectoryKey = (notebook: string, parentID: string) => JSON.stringify([notebook, parentID]);

export const docTreeParentID = (item: IDocTreeItem) =>
    item.kind === "notebook" || item.id === item.notebookId ? "" : item.id;
