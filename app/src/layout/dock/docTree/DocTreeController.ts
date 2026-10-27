import {DocTreeModel, getDocTreeWindow, type IDocTreeDirectory} from "./DocTreeModel";
import {docTreeDataSource} from "./dataSource";
import {getTransactionOperations} from "../../../util/transactionOperations";
import {docTreeParentID, type IDocTreeDataSource, type IDocTreeExpansion, type IDocTreeItem, type IDocTreeRoot,
    type IDocTreeSelectOptions} from "./types";

interface IDocTreeControllerOptions {
    element: HTMLElement;
    roots?: IDocTreeRoot[];
    renderRow: (item: IDocTreeItem) => HTMLElement;
    source?: IDocTreeDataSource;
    batchSize?: () => number;
    onSelectionChange?: () => void;
    onExpansionChange?: () => void;
    onRowsRendered?: () => void;
    onSelectionProgress?: (loaded: number, total: number, cancel: () => void) => void;
}

export interface IDocTreeScrollAnchor {
    notebookId?: string;
    id?: string;
    occurrenceKey?: string;
    parentKey?: string;
    index: number;
    offset: number;
}

const controllers = new WeakMap<Element, DocTreeController>();
let activeController: WeakRef<DocTreeController>;

export const getActiveDocTreeController = (root?: Element) => {
    const active = activeController?.deref();
    return active && (!root || root.contains(active.options.element)) ? active : undefined;
};

export const getDocTreeController = (element: Element): DocTreeController | undefined => {
    while (element) {
        const controller = controllers.get(element);
        if (controller) {
            return controller;
        }
        element = element.parentElement;
    }
};

// 一个滚动容器共享行投影和窗口，选择与展开不依赖已挂载的 DOM。
export class DocTreeController {
    public readonly model = new DocTreeModel();
    private source: IDocTreeDataSource;
    private list: HTMLElement;
    private selected = new Map<string, IDocTreeItem>();
    private focused: string;
    private anchor: string;
    private focusedItem: IDocTreeItem;
    private anchorItem: IDocTreeItem;
    private version = 0;
    private operation = 0;
    private interaction = 0;
    private generation = 0;
    private disposed = false;
    private frame = 0;
    private rowHeight = 28;
    private rowSpacing = 0;
    private mounted = new Map<string, {element: HTMLElement, signature: string}>();
    private inFlight = new Map<string, Promise<void>>();
    private pages = new Map<string, {directory: IDocTreeDirectory, start: number, count: number}>();
    private errors = new Set<string>();
    private observer: ResizeObserver;
    private events = new AbortController();
    private dragging: string;
    private selectionPending = 0;
    private activeRequests = 0;
    private requestQueue: (() => void)[] = [];

    constructor(public readonly options: IDocTreeControllerOptions) {
        this.source = options.source || docTreeDataSource;
        this.list = document.createElement("ul");
        this.list.className = "b3-list b3-list--background";
        this.list.setAttribute("role", "tree");
        this.list.setAttribute("aria-multiselectable", "true");
        this.list.tabIndex = 0;
        this.list.style.margin = "0";
        this.list.style.padding = "0";
        this.list.style.minHeight = "0";
        this.list.style.display = "flex";
        this.list.style.flexDirection = "column";
        options.element.replaceChildren(this.list);
        controllers.set(options.element, this);
        const signal = this.events.signal;
        options.element.addEventListener("scroll", () => this.scheduleRender(), {passive: true, signal});
        // 真实输入取消迟到的状态恢复；程序设置 scrollTop 不应中断自己的定位。
        for (const event of ["pointerdown", "wheel"] as const) {
            options.element.addEventListener(event, () => this.interaction++, {passive: true, signal});
        }
        options.element.addEventListener("keydown", event => {
            if (event.key === "Escape" && this.selectionPending) {
                this.operation++;
                this.finishSelection(this.selectionPending);
                event.preventDefault();
                event.stopPropagation();
            }
        }, {capture: true, signal});
        options.element.addEventListener("dragstart", event => {
            this.dragging = this.getItemFromElement(event.target as Element)?.occurrenceKey;
        }, {capture: true, signal});
        options.element.addEventListener("dragend", () => {
            this.dragging = undefined;
            this.scheduleRender();
        }, {signal});
        options.element.addEventListener("click", event => {
            const placeholder = (event.target as Element).closest<HTMLElement>("[data-tree-loading]");
            if (!placeholder) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            const parent = this.getItem(placeholder.dataset.parentKey);
            if (parent) {
                this.errors.delete(this.model.directory(parent).key);
                void this.load(parent, Number(placeholder.dataset.index)).catch((): void => undefined);
            }
        }, {capture: true, signal});
        this.observer = new ResizeObserver(() => this.scheduleRender());
        this.observer.observe(options.element);
        this.setRoots(options.roots || []);
    }

    public get selectionVersion() { return this.version; }
    public get interactionVersion() { return this.interaction; }

    public setRoots(roots: IDocTreeRoot[]) {
        if (this.disposed) { return; }
        const anchor = this.getScrollAnchor();
        const notebooks = new Set(roots.filter(root => !root.unavailable).map(root => root.notebookId));
        new Set(this.model.roots.map(root => root.notebookId)).forEach(notebookId => {
            if (!notebooks.has(notebookId)) {
                this.removeNotebook(notebookId);
            }
        });
        this.model.setRoots(roots);
        const rootKeys = new Set(this.model.roots.filter(root => !root.unavailable).map(root => root.occurrenceKey));
        const available = (item?: IDocTreeItem) => item && notebooks.has(item.notebookId) &&
            rootKeys.has(item.occurrenceKey.split("/")[0]);
        let changed = false;
        for (const [key, item] of this.selected) {
            if (!available(item)) {
                this.selected.delete(key);
                changed = true;
            }
        }
        if (!available(this.getItem(this.focused))) {
            this.focused = undefined;
            this.focusedItem = undefined;
        }
        if (!available(this.getItem(this.anchor))) {
            this.anchor = undefined;
            this.anchorItem = undefined;
        }
        if (changed) {
            this.selectionChanged();
        }
        this.restoreScrollAnchor(anchor);
        this.render();
    }

    public getItem(key: string) {
        return this.model.getItem(key) || this.selected.get(key) ||
            (key === this.focused ? this.focusedItem : undefined) ||
            (key === this.anchor ? this.anchorItem : undefined);
    }

    private positionOf(key: string) {
        return this.model.indexOf(key, this.getItem(key));
    }

    public getItemFromElement(element: Element): IDocTreeItem | undefined {
        const row = element?.closest<HTMLElement>("[data-tree-key]");
        return row && getDocTreeController(row) === this ? this.getItem(row.dataset.treeKey) : undefined;
    }

    public getFocusedItem() { return this.getItem(this.focused); }
    public getMountedElement(key: string) { return this.mounted.get(key)?.element; }
    public isExpanded(key: string) { return this.model.expanded.has(key); }
    public retain(key: string) { this.dragging = key; }
    public release(key?: string) {
        if (!key || this.dragging === key) {
            this.dragging = undefined;
            this.scheduleRender();
        }
    }

    public findItem(notebookId: string, id: string, rootKey?: string): IDocTreeItem | undefined {
        const roots = this.model.roots.filter(root => root.notebookId === notebookId &&
            (!rootKey || root.occurrenceKey === rootKey));
        const root = roots.find(item => item.id === id);
        if (root) {
            return root;
        }
        for (const parent of [...roots, ...this.model.expanded.values()]) {
            if (parent.notebookId !== notebookId || (rootKey && !parent.occurrenceKey.startsWith(rootKey + "/") &&
                parent.occurrenceKey !== rootKey)) {
                continue;
            }
            for (const [index, file] of this.model.directory(parent).files) {
                if (file.id === id) {
                    return this.model.child(parent, index);
                }
            }
        }
    }

    public setFocused(key: string | undefined) {
        this.interaction++;
        if (key === this.focused) {
            return;
        }
        this.focusedItem = this.getItem(key);
        this.anchorItem = this.focusedItem;
        this.focused = key;
        this.anchor = key;
        this.version++;
        this.scheduleRender();
    }

    public getSelectedItems(): IDocTreeItem[] {
        return Array.from(this.selected.values(), item => this.model.getItem(item.occurrenceKey) || item);
    }

    public validateSelection(version: number, items: readonly IDocTreeItem[]) {
        return version === this.version && items.length === this.selected.size && items.every(item => {
            const current = this.selected.get(item.occurrenceKey);
            return current?.id === item.id && current.path === item.path && current.notebookId === item.notebookId;
        });
    }

    public getSelectionElements(): NodeListOf<HTMLElement> {
        const container = document.createElement("div");
        this.getSelectedItems().forEach(item => {
            const wrapper = document.createElement("ul");
            wrapper.dataset.url = item.notebookId;
            wrapper.dataset.sortmode = String(item.notebook?.sortMode ?? item.effectiveSortMode);
            wrapper.setAttribute("data-effective-sort-mode", String(item.effectiveSortMode));
            const row = this.options.renderRow(item);
            this.decorate(row, item);
            wrapper.append(row);
            container.append(wrapper);
        });
        return container.querySelectorAll<HTMLElement>("[data-tree-key]");
    }

    private selectionChanged() {
        if (this.selected.size) {
            activeController = new WeakRef(this);
        } else if (activeController?.deref() === this) {
            activeController = undefined;
        }
        this.version++;
        this.scheduleRender();
        this.options.onSelectionChange?.();
    }

    private finishSelection(operation: number) {
        if (!operation || this.selectionPending !== operation) { return; }
        this.selectionPending = 0;
        this.list.removeAttribute("aria-busy");
        this.options.onSelectionProgress?.(0, 0, () => {});
    }

    public clearSelection() {
        this.interaction++;
        this.operation++;
        this.finishSelection(this.selectionPending);
        this.anchor = undefined;
        this.anchorItem = undefined;
        if (!this.selected.size) {
            return;
        }
        this.selected.clear();
        this.selectionChanged();
    }

    public async select(key: string, options: IDocTreeSelectOptions = {}, userAction = true) {
        const item = this.getItem(key);
        if (!item || item.unavailable) {
            return;
        }
        if (userAction) { this.interaction++; }
        this.finishSelection(this.selectionPending);
        const operation = ++this.operation;
        if (options.range && this.anchor) {
            const start = this.positionOf(this.anchor);
            const end = this.positionOf(key);
            if (start >= 0 && end >= 0) {
                const selection = new Map<string, IDocTreeItem>();
                const generation = this.generation;
                const total = Math.abs(end - start) + 1;
                const cancel = () => {
                    if (this.selectionPending === operation) {
                        this.operation++;
                        this.finishSelection(operation);
                    }
                };
                this.selectionPending = operation;
                this.list.setAttribute("aria-busy", "true");
                this.options.onSelectionProgress?.(0, total, cancel);
                try {
                    for (let position = Math.min(start, end); position <= Math.max(start, end); position++) {
                        const next = await this.itemAt(position);
                        if (this.disposed || operation !== this.operation || generation !== this.generation) {
                            return;
                        }
                        if (!next) { return; }
                        if (next && !next.unavailable) {
                            selection.set(next.occurrenceKey, next);
                        }
                        const loaded = position - Math.min(start, end) + 1;
                        if (loaded % 64 === 0 || loaded === total) {
                            this.options.onSelectionProgress?.(loaded, total, cancel);
                        }
                    }
                    this.selected = selection;
                } finally {
                    this.finishSelection(operation);
                }
            }
        } else if (options.toggle) {
            if (this.selected.has(key)) {
                this.selected.delete(key);
            } else {
                this.selected.set(key, item);
            }
            this.anchor = key;
            this.anchorItem = item;
        } else {
            this.selected = new Map([[key, item]]);
            this.anchor = key;
            this.anchorItem = item;
        }
        this.focused = key;
        this.focusedItem = item;
        this.selectionChanged();
        if (options.scroll !== false) {
            await this.ensureRendered(key);
        }
    }

    public async toggle(key: string, expanded = !this.isExpanded(key), userAction = true) {
        const item = this.getItem(key);
        if (!item || item.unavailable) {
            return;
        }
        if (userAction) {
            this.interaction++;
            this.operation++;
            this.finishSelection(this.selectionPending);
        }
        const interaction = this.interaction;
        const generation = this.generation;
        const anchor = this.getScrollAnchor();
        if (expanded) {
            this.model.expanded.set(key, item);
            this.model.project();
            this.render();
            await this.load(item, 0);
        } else {
            for (const expandedKey of this.model.expanded.keys()) {
                if (expandedKey === key || expandedKey.startsWith(key + "/")) {
                    this.model.expanded.delete(expandedKey);
                }
            }
            let changed = false;
            for (const selectedKey of this.selected.keys()) {
                if (selectedKey.startsWith(key + "/")) {
                    this.selected.delete(selectedKey);
                    changed = true;
                }
            }
            if (this.focused?.startsWith(key + "/")) {
                this.focused = key;
                this.focusedItem = item;
                this.selected.set(key, item);
                changed = true;
            }
            if (this.anchor?.startsWith(key + "/")) {
                this.anchor = key;
                this.anchorItem = item;
            }
            if (changed) { this.selectionChanged(); }
            this.model.project();
        }
        if (this.disposed || interaction !== this.interaction || generation !== this.generation) { return; }
        this.restoreScrollAnchor(anchor);
        this.render();
        this.options.onExpansionChange?.();
    }

    public collapseAll() {
        this.operation++;
        this.model.expanded.clear();
        this.model.project();
        this.clearSelection();
        this.render();
        this.options.onExpansionChange?.();
    }

    public getExpandedItems(): IDocTreeExpansion[] {
        return Array.from(this.model.expanded.values(), item => ({
            occurrenceKey: item.occurrenceKey, notebookId: item.notebookId, id: item.id,
            path: item.path, kind: item.kind,
        }));
    }

    public async restoreExpanded(items: readonly (Pick<IDocTreeExpansion, "notebookId" | "id" | "kind"> & Partial<IDocTreeExpansion>)[]) {
        const generation = this.generation;
        const interaction = this.interaction;
        for (const item of items) {
            if (this.disposed || generation !== this.generation || interaction !== this.interaction) {
                return;
            }
            const key = item.occurrenceKey || (item.kind === "notebook" ? `notebook:${item.notebookId}` : undefined);
            let current = this.model.getItem(key);
            if (!current) {
                await this.locate(item.notebookId, item.id, {select: false, scroll: false,
                    rootKey: item.occurrenceKey?.split("/")[0]});
                if (this.disposed || generation !== this.generation || interaction !== this.interaction) { return; }
                current = this.findItem(item.notebookId, item.id, item.occurrenceKey?.split("/")[0]);
                if (current && key && key !== current.occurrenceKey) {
                    this.model.expanded.delete(key);
                }
            }
            if (current && !current.unavailable) {
                await this.toggle(current.occurrenceKey, true, false);
            }
        }
    }

    public async locate(notebook: string, id: string, options: {select?: boolean, scroll?: boolean, rootKey?: string} = {}, attempt = 0): Promise<HTMLElement> {
        if (this.disposed) { return; }
        if (!attempt && options.select !== false) {
            this.interaction++;
            this.operation++;
            this.finishSelection(this.selectionPending);
        }
        const interaction = this.interaction;
        const generation = this.generation;
        let parent = options.rootKey ? this.model.roots.find(root => root.occurrenceKey === options.rootKey) :
            this.model.roots.find(root => root.notebookId === notebook && root.kind === "notebook") ||
            this.model.roots.find(root => root.notebookId === notebook && root.id === id);
        if (!parent || parent.unavailable) {
            return;
        }
        if (parent.id !== id) {
            let located: Awaited<ReturnType<IDocTreeDataSource["locate"]>>;
            try {
                located = await this.source.locate({notebook, id});
            } catch {
                return;
            }
            if (this.disposed || generation !== this.generation || interaction !== this.interaction) {
                return;
            }
            let started = parent.kind === "notebook";
            for (const step of located.steps) {
                if (!started) {
                    if (step.id === parent.id) {
                        started = true;
                    }
                    continue;
                }
                if (docTreeParentID(parent) !== step.parentID) {
                    return;
                }
                this.model.expanded.set(parent.occurrenceKey, parent);
                const directory = this.model.directory(parent);
                if (directory.revision && directory.revision !== step.revision) {
                    directory.files.clear();
                    directory.indices.clear();
                    directory.generation++;
                }
                directory.total = step.total;
                directory.revision = step.revision;
                directory.effectiveSortMode = step.effectiveSortMode;
                await this.load(parent, step.index);
                if (this.disposed || interaction !== this.interaction) { return; }
                if (this.disposed || generation !== this.generation) {
                    if (!this.disposed && attempt < 2) {
                        return this.locate(notebook, id, options, attempt + 1);
                    }
                    return;
                }
                parent = this.model.child(parent, step.index);
                if (!parent || parent.id !== step.id) {
                    if (attempt < 2) {
                        return this.locate(notebook, id, options, attempt + 1);
                    }
                    return;
                }
            }
            if (parent.id !== id) {
                return;
            }
        }
        this.model.project();
        if (options.select !== false) {
            await this.select(parent.occurrenceKey, {scroll: options.scroll}, false);
        }
        this.options.onExpansionChange?.();
        if (options.scroll === false) {
            this.render();
            return this.getMountedElement(parent.occurrenceKey);
        }
        return this.ensureRendered(parent.occurrenceKey);
    }

    public async itemAtDirectoryIndex(parentKey: string, index: number) {
        const parent = this.getItem(parentKey);
        if (!parent || index < 0) {
            return;
        }
        const directory = this.model.directory(parent);
        if (directory.revision && directory.total !== undefined && index >= directory.total) {
            return;
        }
        await this.load(parent, index);
        return this.model.child(parent, index);
    }

    public sibling(item: IDocTreeItem, delta: number) {
        if (!item.parentKey) {
            return Promise.resolve(this.model.roots[item.index + delta]);
        }
        return this.itemAtDirectoryIndex(item.parentKey, item.index + delta);
    }

    private async itemAt(position: number) {
        const row = this.model.rowAt(position);
        if (row?.item) {
            return row.item;
        }
        if (row?.parent) {
            return this.itemAtDirectoryIndex(row.parent.occurrenceKey, row.index);
        }
    }

    public async focusRelative(delta: number, extend = false) {
        const interaction = ++this.interaction;
        let index = this.positionOf(this.focused);
        index = index < 0 ? (delta < 0 ? this.model.rowCount - 1 : 0) :
            Math.max(0, Math.min(this.model.rowCount - 1, index + delta));
        const item = await this.itemAt(index);
        if (item && interaction === this.interaction) {
            await this.select(item.occurrenceKey, {range: extend});
        }
    }

    public async focusBoundary(boundary: "first" | "last", extend = false) {
        const interaction = ++this.interaction;
        const item = await this.itemAt(boundary === "first" ? 0 : this.model.rowCount - 1);
        if (item && interaction === this.interaction) {
            await this.select(item.occurrenceKey, {range: extend});
        }
    }

    public async focusParent() {
        const parent = this.getFocusedItem()?.parentKey;
        if (parent) {
            await this.select(parent);
        }
    }

    public async expandFocused() {
        if (this.focused) {
            if (this.isExpanded(this.focused)) {
                await this.focusRelative(1);
            } else {
                await this.toggle(this.focused, true);
            }
        }
    }

    public async collapseFocused() {
        if (this.focused) {
            if (this.isExpanded(this.focused)) {
                await this.toggle(this.focused, false);
            } else {
                await this.focusParent();
            }
        }
    }

    public async ensureRendered(key: string): Promise<HTMLElement> {
        let position = this.positionOf(key);
        if (position < 0) {
            return;
        }
        const generation = this.generation;
        const interaction = this.interaction;
        const item = await this.itemAt(position);
        if (this.disposed || generation !== this.generation || interaction !== this.interaction || item?.occurrenceKey !== key) {
            return;
        }
        // 定位前先读取当前主题的实际行距；已淘汰的目标批次也必须重新加载。
        this.render();
        position = this.positionOf(key);
        if (position < 0) { return; }
        const element = this.options.element;
        const top = position * this.rowHeight;
        if (top < element.scrollTop) {
            element.scrollTop = top;
        } else if (top + this.rowHeight > element.scrollTop + element.clientHeight) {
            element.scrollTop = Math.max(0, top + this.rowHeight - element.clientHeight);
        }
        this.render();
        return this.getMountedElement(key);
    }

    public getScrollAnchor(): IDocTreeScrollAnchor {
        const position = Math.floor(this.options.element.scrollTop / this.rowHeight);
        const row = this.model.rowAt(position);
        return {notebookId: row?.item?.notebookId, id: row?.item?.id,
            occurrenceKey: row?.item?.occurrenceKey, parentKey: row?.parent?.occurrenceKey,
            index: row?.index ?? 0, offset: this.options.element.scrollTop - position * this.rowHeight};
    }

    public restoreScrollAnchor(anchor?: IDocTreeScrollAnchor) {
        if (!anchor) {
            return;
        }
        let position = anchor.occurrenceKey ? this.positionOf(anchor.occurrenceKey) : -1;
        if (position < 0 && anchor.parentKey) {
            const parent = this.getItem(anchor.parentKey);
            const child = parent && this.model.child(parent, anchor.index);
            position = child ? this.positionOf(child.occurrenceKey) : this.positionOf(anchor.parentKey) + 1 + anchor.index;
        }
        if (position >= 0) {
            this.options.element.scrollTop = position * this.rowHeight + anchor.offset;
        }
    }

    public async reload(filter: {notebook?: string, parentID?: string} = {}) {
        if (this.disposed) { return; }
        const interaction = this.interaction;
        const anchor = this.getScrollAnchor();
        const affected = (item: IDocTreeItem) => (!filter.notebook || item.notebookId === filter.notebook) &&
            (filter.parentID === undefined || item.parentID === filter.parentID);
        const parents = new Map<string, IDocTreeItem>();
        const affectedBranches = Array.from(this.model.expanded.values()).filter(item =>
            (!filter.notebook || item.notebookId === filter.notebook) &&
            (filter.parentID === undefined || docTreeParentID(item) === filter.parentID));
        const expanded = this.getExpandedItems().filter(item => affectedBranches.some(branch =>
            item.occurrenceKey === branch.occurrenceKey || item.occurrenceKey.startsWith(branch.occurrenceKey + "/")));
        const selected = this.getSelectedItems();
        selected.forEach(item => {
            const parent = this.model.getItem(item.parentKey);
            if (parent) { parents.set(parent.occurrenceKey, parent); }
        });
        const generation = ++this.generation;
        const operation = ++this.operation;
        this.finishSelection(this.selectionPending);
        if (this.focusedItem && affected(this.focusedItem) && this.focusedItem.parentKey) {
            this.focusedItem = undefined;
        }
        if (this.anchorItem && affected(this.anchorItem) && this.anchorItem.parentKey) {
            this.anchorItem = undefined;
        }
        this.model.invalidate(filter.notebook, filter.parentID);
        for (const [key, page] of this.pages) {
            if ((!filter.notebook || page.directory.notebookId === filter.notebook) &&
                (filter.parentID === undefined || page.directory.parentID === filter.parentID)) {
                this.pages.delete(key);
            }
        }
        this.selected = new Map(selected.filter(item => !affected(item) || !item.parentKey).map(item => [item.occurrenceKey, item]));
        this.errors.clear();
        this.version++;
        await this.restoreExpanded(expanded);
        if (this.disposed || generation !== this.generation) {
            return;
        }
        const nextSelection = new Map(this.selected);
        const groups = new Map<string, IDocTreeItem[]>();
        for (const item of selected) {
            if (affected(item) && item.parentKey) {
                const group = groups.get(item.parentKey) || [];
                group.push(item);
                groups.set(item.parentKey, group);
            }
        }
        for (const [parentKey, group] of groups) {
            if (this.disposed || generation !== this.generation || operation !== this.operation) {
                return;
            }
            if (group.length <= 2) {
                for (const item of group) {
                    await this.locate(item.notebookId, item.id, {select: false, scroll: false,
                        rootKey: item.occurrenceKey.split("/")[0]});
                    const current = this.findItem(item.notebookId, item.id, item.occurrenceKey.split("/")[0]);
                    if (current) { nextSelection.set(current.occurrenceKey, current); }
                }
            } else {
                const parent = this.model.getItem(parentKey) || parents.get(parentKey);
                if (!parent) { continue; }
                const ids = new Set(group.map(item => item.id));
                const directory = this.model.directory(parent);
                const limit = this.batchSize();
                for (let offset = 0; offset < (directory.total ?? 1) && ids.size; offset += limit) {
                    await this.load(parent, offset);
                    if (this.disposed || generation !== this.generation || operation !== this.operation) { return; }
                    for (let index = offset; index < Math.min(offset + limit, directory.total); index++) {
                        const current = this.model.child(parent, index);
                        if (current && ids.delete(current.id)) {
                            nextSelection.set(current.occurrenceKey, current);
                        }
                    }
                }
            }
        }
        if (this.disposed || generation !== this.generation || operation !== this.operation) {
            return;
        }
        this.selected = nextSelection;
        this.focusedItem = this.getItem(this.focused);
        this.anchorItem = this.getItem(this.anchor);
        if (interaction === this.interaction) {
            this.restoreScrollAnchor(anchor);
        }
        this.render();
        this.options.onSelectionChange?.();
    }

    public handleMessage(data: IWebSocketData) {
        if (["closeBox", "removeBox"].includes(data.cmd)) {
            const notebook = typeof data.data === "string" ? data.data : data.data.box?.id || data.data.box || data.data.id;
            if (typeof notebook === "string") {
                this.removeNotebook(notebook);
            }
        } else if (data.cmd === "transactions") {
            getTransactionOperations(data.data).forEach(operation => {
                if (operation.action !== "updateAttrs" || operation.id !== operation.rootID) { return; }
                const attrs = operation.data;
                if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) { return; }
                const previous = attrs.old || {};
                const next = attrs.new || {};
                const metadata: Partial<IFile> = {};
                for (const key of ["icon", "alias", "memo", "bookmark"] as const) {
                    if (previous[key] !== next[key]) { metadata[key] = next[key] || ""; }
                }
                if (previous.name !== next.name) { metadata.name1 = next.name || ""; }
                if (previous.title !== next.title && next.title !== undefined) {
                    metadata.name = next.title;
                }
                if (previous.title !== next.title || previous["custom-sy-title-empty"] !== next["custom-sy-title-empty"]) {
                    metadata.titleEmpty = next["custom-sy-title-empty"] === "true";
                }
                this.applyMetadata(operation.id, metadata, false);
            });
        } else if (data.cmd === "reloadDocInfo") {
            const metadata: Partial<IFile> = {};
            for (const key of ["name", "name1", "alias", "memo", "bookmark", "icon", "hMtime", "hCtime", "hSize", "subFileCount", "count", "titleEmpty"] as const) {
                if (data.data[key] !== undefined) { Object.assign(metadata, {[key]: data.data[key]}); }
            }
            this.applyMetadata(data.data.rootID, metadata, true);
        } else if (["create", "heading2doc", "li2doc", "createdailynote", "rename"].includes(data.cmd)) {
            const notebook = data.data.box?.id || data.data.box;
            const path = data.data.path;
            if (typeof notebook === "string" && typeof path === "string") {
                const parentID = path.split("/").filter(Boolean).slice(-2, -1)[0] || "";
                void this.reload({notebook, parentID});
            }
        } else if (["reloadFiletree", "removeDoc", "moveDocs", "mount"].includes(data.cmd)) {
            void this.reload();
        }
    }

    private applyMetadata(id: string, metadata: Partial<IFile>, refreshSort: boolean) {
        const changed = new Map<string, {notebook: string, parentID: string}>();
        const updateItem = (item: IDocTreeItem) => {
            if (item.id !== id) { return item; }
            return {...item, name: metadata.name ?? item.name, subFileCount: metadata.subFileCount ?? item.subFileCount,
                file: item.file ? {...item.file, ...metadata} : undefined};
        };
        this.selected.forEach((item, key) => this.selected.set(key, updateItem(item)));
        if (this.focusedItem) { this.focusedItem = updateItem(this.focusedItem); }
        if (this.anchorItem) { this.anchorItem = updateItem(this.anchorItem); }
        this.model.expanded.forEach((item, key) => this.model.expanded.set(key, updateItem(item)));
        this.model.roots = this.model.roots.map(updateItem);
        this.model.directories.forEach(directory => {
            const index = directory.indices.get(id);
            const file = index === undefined ? undefined : directory.files.get(index);
            if (!file) { return; }
            directory.files.set(index, {...file, ...metadata});
            if (refreshSort && [2, 3, 7, 8, 11, 12, 13, 14].includes(directory.effectiveSortMode)) {
                changed.set(directory.key, {notebook: directory.notebookId, parentID: directory.parentID});
            }
        });
        this.model.project();
        this.scheduleRender();
        void (async () => {
            for (const filter of changed.values()) { await this.reload(filter); }
        })();
    }

    public removeNotebook(notebook: string) {
        this.generation++;
        this.interaction++;
        this.operation++;
        this.finishSelection(this.selectionPending);
        if (this.getItem(this.focused)?.notebookId === notebook) {
            this.focused = undefined;
            this.focusedItem = undefined;
        }
        if (this.getItem(this.anchor)?.notebookId === notebook) {
            this.anchor = undefined;
            this.anchorItem = undefined;
        }
        this.model.removeNotebook(notebook);
        this.model.setRoots(this.model.roots.filter(root => root.notebookId !== notebook));
        for (const [key, item] of this.selected) {
            if (item.notebookId === notebook) {
                this.selected.delete(key);
            }
        }
        for (const [key, page] of this.pages) {
            if (page.directory.notebookId === notebook) {
                this.pages.delete(key);
            }
        }
        this.selectionChanged();
        this.render();
    }

    private async limited<T>(request: () => Promise<T>): Promise<T> {
        if (this.activeRequests >= 4) {
            await new Promise<void>(resolve => this.requestQueue.push(resolve));
        }
        this.activeRequests++;
        try {
            return await request();
        } finally {
            this.activeRequests--;
            this.requestQueue.shift()?.();
        }
    }

    private batchSize() {
        return Math.max(1, Math.min(10240, Math.floor(this.options.batchSize?.() ??
            window.siyuan?.config?.fileTree?.docTreeBatchSize ?? 512)));
    }

    private async load(parent: IDocTreeItem, index: number) {
        const directory = this.model.directory(parent);
        if (directory.files.has(index) || (directory.revision && directory.total !== undefined && index >= directory.total)) {
            return;
        }
        const limit = this.batchSize();
        const offset = Math.floor(index / limit) * limit;
        const generation = this.generation;
        let directoryGeneration = directory.generation;
        let stale = false;
        const key = `${directory.key}:${offset}:${directoryGeneration}:${generation}`;
        if (this.inFlight.has(key)) {
            return this.inFlight.get(key);
        }
        const request = this.limited(async () => {
            if (this.disposed || generation !== this.generation || directoryGeneration !== directory.generation) {
                return;
            }
            let range = await this.source.range({notebook: directory.notebookId, parentID: directory.parentID,
                offset, limit, revision: directory.revision});
            if (this.disposed || generation !== this.generation || directoryGeneration !== directory.generation) {
                return;
            }
            if (range.stale) {
                stale = true;
                directoryGeneration = ++directory.generation;
                directory.files.clear();
                directory.indices.clear();
                for (const [pageKey, page] of this.pages) {
                    if (page.directory === directory) {
                        this.pages.delete(pageKey);
                    }
                }
                directory.revision = undefined;
                directory.total = range.total;
                this.operation++;
                this.version++;
                range = await this.source.range({notebook: directory.notebookId, parentID: directory.parentID, offset, limit});
            }
            if (this.disposed || generation !== this.generation || directoryGeneration !== directory.generation || range.stale) {
                return;
            }
            this.model.applyRange(directory, range);
            this.pages.delete(key);
            this.pages.set(key, {directory, start: range.offset, count: range.files.length});
            this.errors.delete(directory.key);
            this.evictPages();
            this.scheduleRender();
        }).catch(error => {
            if (!this.disposed && generation === this.generation) {
                this.errors.add(directory.key);
                this.scheduleRender();
            }
            console.warn("Failed to load document tree range", error);
        }).then(async () => {
            if (stale && !this.disposed && generation === this.generation) {
                await this.reload({notebook: directory.notebookId, parentID: directory.parentID});
            }
        }).finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, request);
        return request;
    }

    private evictPages() {
        let count = Array.from(this.pages.values()).reduce((total, page) => total + page.count, 0);
        const viewport = getDocTreeWindow(this.model.rowCount, this.options.element.scrollTop,
            this.options.element.clientHeight, this.rowHeight);
        for (const [key, page] of this.pages) {
            if (count <= 32768 && this.pages.size <= 64) {
                break;
            }
            let visible = false;
            for (let position = viewport.start; position < viewport.end; position++) {
                const row = this.model.rowAt(position);
                if (row?.parent && this.model.directory(row.parent) === page.directory &&
                    row.index >= page.start && row.index < page.start + page.count) {
                    visible = true;
                    break;
                }
            }
            if (visible) {
                continue;
            }
            this.pages.delete(key);
            count -= page.count;
            for (let index = page.start; index < page.start + page.count; index++) {
                const file = page.directory.files.get(index);
                const expanded = file && Array.from(this.model.expanded.values()).some(item =>
                    item.notebookId === page.directory.notebookId && item.id === file.id);
                if (!expanded) {
                    page.directory.files.delete(index);
                    if (file) {
                        page.directory.indices.delete(file.id);
                    }
                }
            }
        }
    }

    private scheduleRender() {
        if (!this.frame && !this.disposed) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.render();
            });
        }
    }

    private decorate(row: HTMLElement, item: IDocTreeItem) {
        row.style.flexShrink = "0";
        controllers.set(row, this);
        row.dataset.treeKey = item.occurrenceKey;
        row.dataset.occurrenceKey = item.occurrenceKey;
        if (item.kind === "document") {
            row.dataset.nodeId = item.id;
        }
        row.dataset.notebookId = item.notebookId;
        row.dataset.notebook = item.notebookId;
        row.dataset.parentId = item.parentID;
        row.dataset.path = item.path;
        row.dataset.name = item.name;
        row.dataset.count = String(item.subFileCount);
        row.dataset.sortmode = String(item.effectiveSortMode);
        row.dataset.effectiveSortMode = String(item.effectiveSortMode);
        row.dataset.childrenSortMode = item.childrenSortMode?.toString() ?? "";
        if (item.kind === "notebook") {
            row.dataset.url = item.notebookId;
        }
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-level", String(item.depth + 1));
        row.setAttribute("aria-posinset", String(item.index + 1));
        row.setAttribute("aria-setsize", String(item.setSize));
        row.setAttribute("aria-selected", String(this.selected.has(item.occurrenceKey)));
        row.classList.toggle("b3-list-item--focus", this.selected.has(item.occurrenceKey));
        row.tabIndex = item.occurrenceKey === this.focused ? 0 : -1;
        if (item.subFileCount > 0 || item.kind === "notebook") {
            row.setAttribute("aria-expanded", String(this.isExpanded(item.occurrenceKey)));
        } else {
            row.removeAttribute("aria-expanded");
        }
        row.querySelector(".b3-list-item__arrow")?.classList.toggle("b3-list-item__arrow--open", this.isExpanded(item.occurrenceKey));
    }

    private render() {
        if (this.disposed) {
            return;
        }
        const element = this.options.element;
        const sample = this.mounted.values().next().value?.element as HTMLElement | undefined;
        const measured = sample?.getBoundingClientRect().height;
        const style = sample && getComputedStyle(sample);
        this.rowSpacing = style ? (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0) : this.rowSpacing;
        const configured = parseFloat(getComputedStyle(element).getPropertyValue("--b3-ui-list-height"));
        const rowHeight = measured > 0 ? measured + this.rowSpacing : configured > 0 ? configured + this.rowSpacing : this.rowHeight;
        if (Math.abs(rowHeight - this.rowHeight) > 0.1) {
            const anchor = this.getScrollAnchor();
            this.rowHeight = rowHeight;
            this.restoreScrollAnchor(anchor);
        }
        const viewport = getDocTreeWindow(this.model.rowCount, element.scrollTop, element.clientHeight, this.rowHeight);
        const positions = new Set<number>();
        for (let index = viewport.start; index < viewport.end; index++) {
            positions.add(index);
        }
        [this.dragging, this.getItemFromElement(document.activeElement)?.occurrenceKey].forEach(key => {
            const index = this.positionOf(key);
            if (index >= 0) {
                positions.add(index);
            }
        });
        const children: HTMLElement[] = [];
        const retained = new Set<string>();
        let previous = 0;
        const spacer = (count: number) => {
            if (count <= 0) {
                return;
            }
            const node = document.createElement("li");
            node.dataset.treeSpacer = "true";
            node.setAttribute("role", "presentation");
            node.setAttribute("aria-hidden", "true");
            node.style.height = `${count * this.rowHeight}px`;
            node.style.flexShrink = "0";
            node.style.pointerEvents = "none";
            children.push(node);
        };
        Array.from(positions).sort((a, b) => a - b).forEach(position => {
            spacer(position - previous);
            previous = position + 1;
            const projected = this.model.rowAt(position);
            const item = projected?.item;
            if (item) {
                const signature = JSON.stringify([item.file, item.notebook, item.name, item.path, item.index, item.setSize, item.unavailable]);
                let mounted = this.mounted.get(item.occurrenceKey);
                if (!mounted || (mounted.signature !== signature && !mounted.element.contains(document.activeElement) &&
                    item.occurrenceKey !== this.dragging)) {
                    if (mounted) { this.observer.unobserve(mounted.element); }
                    mounted = {element: this.options.renderRow(item), signature};
                    this.mounted.set(item.occurrenceKey, mounted);
                }
                retained.add(item.occurrenceKey);
                this.decorate(mounted.element, item);
                children.push(mounted.element);
            } else if (projected?.parent) {
                const placeholder = document.createElement("li");
                placeholder.dataset.treeLoading = "true";
                placeholder.dataset.parentKey = projected.parent.occurrenceKey;
                placeholder.dataset.index = String(projected.index);
                placeholder.setAttribute("role", "presentation");
                placeholder.style.height = `${Math.max(1, this.rowHeight - this.rowSpacing)}px`;
                placeholder.style.flexShrink = "0";
                placeholder.className = "b3-list-item";
                placeholder.style.opacity = "0.4";
                const directory = this.model.directory(projected.parent);
                placeholder.textContent = this.errors.has(directory.key) ? window.siyuan?.languages?.retry || "" :
                    window.siyuan?.languages?.loading || "";
                children.push(placeholder);
                if (!this.errors.has(directory.key)) {
                    void this.load(projected.parent, projected.index).catch((): void => undefined);
                }
            }
        });
        spacer(this.model.rowCount - previous);
        for (const [key, mounted] of this.mounted) {
            if (!retained.has(key)) {
                this.observer.unobserve(mounted.element);
                this.mounted.delete(key);
            }
        }
        // 按位置移动既有行，避免滚动时替换整个列表或重建活动行。
        let current = this.list.firstElementChild;
        children.forEach(child => {
            if (current === child) {
                current = current.nextElementSibling;
            } else {
                this.list.insertBefore(child, current);
            }
        });
        while (current) {
            const next = current.nextElementSibling;
            current.remove();
            current = next;
        }
        const first = this.mounted.values().next().value?.element as HTMLElement | undefined;
        if (first) {
            this.observer.observe(first);
        }
        this.options.onRowsRendered?.();
    }

    public destroy() {
        this.disposed = true;
        this.interaction++;
        this.generation++;
        this.operation++;
        cancelAnimationFrame(this.frame);
        this.events.abort();
        this.observer.disconnect();
        this.model.directories.clear();
        this.model.expanded.clear();
        this.model.setRoots([]);
        this.selected.clear();
        this.focused = undefined;
        this.focusedItem = undefined;
        this.anchor = undefined;
        this.anchorItem = undefined;
        this.mounted.clear();
        this.pages.clear();
        this.errors.clear();
        this.inFlight.clear();
        this.options.onSelectionProgress?.(0, 0, () => { this.operation++; });
        controllers.delete(this.options.element);
        if (activeController?.deref() === this) {
            activeController = undefined;
        }
        this.options.element.replaceChildren();
    }
}
