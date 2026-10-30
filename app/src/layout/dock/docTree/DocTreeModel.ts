import {docTreeDirectoryKey, docTreeParentID, type IDocTreeItem, type IDocTreeRange, type IDocTreeRoot} from "./types";

export interface IDocTreeDirectory {
    key: string;
    notebookId: string;
    parentID: string;
    total?: number;
    revision?: string;
    effectiveSortMode: number;
    generation: number;
    files: Map<number, IFile>;
    indices: Map<string, number>;
}

export interface IDocTreeRow {
    item?: IDocTreeItem;
    parent?: IDocTreeItem;
    index: number;
    position: number;
}

interface IRowSpan {
    position: number;
    length: number;
    item?: IDocTreeItem;
    parent?: IDocTreeItem;
    start?: number;
}

// 未加载的兄弟节点只保留区间长度，展开节点才产生额外的投影区间。
export class DocTreeModel {
    public roots: IDocTreeItem[] = [];
    public directories = new Map<string, IDocTreeDirectory>();
    public expanded = new Map<string, IDocTreeItem>();
    private spans: IRowSpan[] = [];
    public rowCount = 0;

    public setRoots(roots: IDocTreeRoot[]) {
        this.roots = roots.map((root, index) => ({
            ...root,
            occurrenceKey: root.occurrenceKey || `${root.kind === "notebook" ? "notebook" : "pin"}:${root.id}`,
            parentID: "",
            childrenSortMode: root.childrenSortMode ?? null,
            effectiveSortMode: root.effectiveSortMode ?? 15,
            depth: 0,
            index,
            setSize: roots.length,
        }));
        const rootKeys = new Set(this.roots.map(root => root.occurrenceKey));
        for (const key of this.expanded.keys()) {
            if (!rootKeys.has(key.split("/")[0])) {
                this.expanded.delete(key);
            }
        }
        this.project();
    }

    public directory(item: IDocTreeItem): IDocTreeDirectory {
        const parentID = docTreeParentID(item);
        const key = docTreeDirectoryKey(item.notebookId, parentID);
        let directory = this.directories.get(key);
        if (!directory) {
            directory = {
                key, notebookId: item.notebookId, parentID, generation: 0,
                effectiveSortMode: item.childrenSortMode ?? item.effectiveSortMode,
                files: new Map(), indices: new Map(),
            };
            this.directories.set(key, directory);
        }
        return directory;
    }

    public applyRange(directory: IDocTreeDirectory, range: IDocTreeRange) {
        if (directory.revision && directory.revision !== range.revision) {
            directory.files.clear();
            directory.indices.clear();
            directory.generation++;
        }
        directory.total = range.total;
        directory.revision = range.revision;
        directory.effectiveSortMode = range.effectiveSortMode;
        range.files.forEach((file, index) => {
            const position = range.offset + index;
            const previous = directory.files.get(position);
            if (previous && previous.id !== file.id) {
                directory.indices.delete(previous.id);
            }
            directory.files.set(position, file);
            directory.indices.set(file.id, position);
        });
        for (const index of directory.files.keys()) {
            if (index >= range.total) {
                directory.indices.delete(directory.files.get(index).id);
                directory.files.delete(index);
            }
        }
        this.project();
    }

    public child(parent: IDocTreeItem, index: number, directory = this.directory(parent)): IDocTreeItem | undefined {
        const file = directory.files.get(index);
        if (!file) {
            return;
        }
        return {
            occurrenceKey: `${parent.occurrenceKey}/${file.id}`,
            parentKey: parent.occurrenceKey,
            id: file.id,
            notebookId: parent.notebookId,
            parentID: docTreeParentID(parent),
            path: file.path,
            name: file.name,
            kind: "document",
            subFileCount: file.subFileCount,
            childrenSortMode: file.childrenSortMode ?? null,
            effectiveSortMode: directory.effectiveSortMode,
            file,
            depth: parent.depth + 1,
            index,
            setSize: directory.total ?? 0,
        };
    }

    public getItem(key: string): IDocTreeItem | undefined {
        if (!key) {
            return;
        }
        const root = this.roots.find(item => item.occurrenceKey === key);
        if (root) {
            return root;
        }
        const separator = key.lastIndexOf("/");
        if (separator < 0) {
            return;
        }
        const parent = this.getItem(key.slice(0, separator));
        if (!parent) {
            return;
        }
        const id = key.slice(separator + 1);
        const index = this.directory(parent).indices.get(id);
        if (index !== undefined) {
            return this.child(parent, index);
        }
    }

    public project() {
        this.spans = [];
        this.rowCount = 0;
        const append = (span: Omit<IRowSpan, "position">) => {
            if (span.length > 0) {
                this.spans.push({...span, position: this.rowCount});
                this.rowCount += span.length;
            }
        };
        const children = (parent: IDocTreeItem) => {
            if (!this.expanded.has(parent.occurrenceKey) || parent.unavailable) {
                return;
            }
            const directory = this.directory(parent);
            const total = directory.total ?? 1;
            const branches = Array.from(this.expanded.values()).filter(item =>
                item.parentKey === parent.occurrenceKey && item.index < total).map(item => {
                const current = this.child(parent, item.index);
                return current?.id === item.id ? current : undefined;
            }).filter(Boolean).sort((a, b) => a.index - b.index);
            let start = 0;
            for (const branch of branches) {
                if (branch.index < start) {
                    continue;
                }
                append({parent, start, length: branch.index - start + 1});
                children(branch);
                start = branch.index + 1;
            }
            append({parent, start, length: total - start});
        };
        this.roots.forEach(item => {
            append({item, length: 1});
            children(item);
        });
    }

    public rowAt(position: number): IDocTreeRow | undefined {
        if (position < 0 || position >= this.rowCount) {
            return;
        }
        let low = 0;
        let high = this.spans.length - 1;
        while (low <= high) {
            const middle = (low + high) >>> 1;
            const span = this.spans[middle];
            if (position < span.position) {
                high = middle - 1;
            } else if (position >= span.position + span.length) {
                low = middle + 1;
            } else if (span.item) {
                return {item: span.item, index: span.item.index, position};
            } else {
                const index = span.start + position - span.position;
                return {item: this.child(span.parent, index), parent: span.parent, index, position};
            }
        }
    }

    public indexOf(key: string, item = this.getItem(key)): number {
        if (!item) {
            return -1;
        }
        for (const span of this.spans) {
            if (span.item?.occurrenceKey === key) {
                return span.position;
            }
            if (span.parent?.occurrenceKey === item.parentKey && item.index >= span.start &&
                item.index < span.start + span.length) {
                return span.position + item.index - span.start;
            }
        }
        return -1;
    }

    public invalidate(notebookId?: string, parentID?: string) {
        for (const directory of this.directories.values()) {
            if ((!notebookId || directory.notebookId === notebookId) &&
                (parentID === undefined || directory.parentID === parentID)) {
                directory.generation++;
                directory.files.clear();
                directory.indices.clear();
                // 保留旧长度作为加载占位，避免刷新等待期间滚动条被浏览器夹回顶部。
                directory.revision = undefined;
            }
        }
        this.project();
    }

    public removeNotebook(notebookId: string) {
        for (const [key, directory] of this.directories) {
            if (directory.notebookId === notebookId) {
                directory.generation++;
                this.directories.delete(key);
            }
        }
        for (const [key, item] of this.expanded) {
            if (item.notebookId === notebookId) {
                this.expanded.delete(key);
            }
        }
        this.project();
    }
}

export const getDocTreeWindow = (count: number, scrollTop: number, height: number, rowHeight: number, overscan = 8) => {
    const size = Math.max(1, rowHeight);
    const start = Math.max(0, Math.min(count, Math.floor(Math.max(0, scrollTop) / size) - overscan));
    const end = Math.max(start, Math.min(count, Math.ceil((Math.max(0, scrollTop) + Math.max(size, height)) / size) + overscan));
    return {start, end, before: start * size, after: (count - end) * size};
};
