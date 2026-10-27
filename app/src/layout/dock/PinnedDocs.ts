import {DocTreeController, getDocTreeController} from "./docTree/DocTreeController";
import type {IDocTreeItem, IDocTreeExpansion} from "./docTree/types";
import {setStorageVal} from "../../protyle/util/compatibility";
import {createDocTreeSelectionProgress} from "./docTree/selectionProgress";
import type {App} from "../../index";
import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {pinnedDocIDs, updatePinnedDocs} from "../../util/pinnedDocs";
import {getPinnedDropPosition} from "../../util/pinnedDocsDrop";
import {getFileTreeIconHTML} from "../../emoji/fileTreeIcon";
import {openEmojiPanel} from "../../emoji";
import {escapeTooltipTextAttr, escapeHtml} from "../../util/escape";
import {genFileTreeDocAriaLabel} from "../../util/fileTreeTooltip";
import {initFileMenu} from "../../menus/navigation";
import {toggleMenu} from "../../menus/menuToggle";
import {globalClickHideMenu} from "../../menus/menuClick";
import {parseDocumentTabDragData, parseDocumentTreeDragData} from "../../util/fileTreeMove";
import {reorderSortedFileTree} from "../../util/fileTreeReorder";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {MenuItem} from "../../menus/Menu";
import {newFileInTree} from "../../util/newFile";
import {isOnlyMeta} from "../../protyle/util/compatibility";
import {FILE_TREE_CHILDREN_SORT_MODE} from "../../util/fileTreeSort";
import {setFileTreeVisibility} from "./fileTreeAnimation";
import {ParentDocClick} from "./parentDocClick";
import {hideDragTip, setDragTipGhost, showDragTip} from "../../protyle/util/dragTip";

// 根入口与子树使用独立容器，避免重复文档干扰源文档树的选择和移动定位。
export class PinnedDocs {
    public element: HTMLElement;
    public docTree: DocTreeController;
    private restored = false;
    private restoring = false;
    private selectionProgress = createDocTreeSelectionProgress();
    private initialState: {version: 2, expanded: string[], collapsed: boolean};
    private list: HTMLElement;
    private heading: HTMLElement;

    private generation = 0;
    private refreshTimer: number;
    private disposed = false;
    private dropTarget: {id: string, position: ReturnType<typeof getPinnedDropPosition>} | undefined;
    private touch: {id: string, x: number, y: number, timer: number, dragging: boolean, ghost?: HTMLElement};
    private suppressClick = false;
    private dragging = false;
    private draggedRow: HTMLElement;
    private sourceEvents = new AbortController();





    public onFileTreeMessage(data: IWebSocketData) {
        if (["closeBox", "removeBox"].includes(data.cmd)) {
            this.generation++;
            this.cancelTouch();
            this.dragging = false;
            this.draggedRow = undefined;
            this.clearDrop();
            window.siyuan.touchDragGhost?.remove();
            window.siyuan.touchDragGhost = undefined;
            window.siyuan.dragElement = undefined;
            window.siyuan.dragTitle = "";
        }
        this.docTree.handleMessage(data);
        if (["pinnedDocsChanged", "reloadFiletree", "rename", "moveDocs", "removeDoc", "create", "heading2doc", "createdailynote", "li2doc", "closeBox", "removeBox", "mount", "notebookIconChanged", "renamenotebook", "boxDocFeatureChanged"].includes(data.cmd)) {
            this.scheduleRefresh();
        }
    }

    constructor(private app: App, private sourceTree: HTMLElement, private open: (id: string, notebook: string) => void,
                private mobile = false, private parentDocClick = new ParentDocClick()) {
        this.element = document.createElement("div");
        this.element.className = "file-tree__pins fn__flex-column fn__none";
        this.element.innerHTML = `<ul class="b3-list b3-list--background fn__flex-column"><li class="b3-list-item" tabindex="0" role="button" data-pin-heading="true"><span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__icon"><svg><use xlink:href="#iconPin"></use></svg></span><span class="b3-list-item__text">${window.siyuan.languages.pinnedDocs}</span></li><ul class="file-tree__pins-list fn__flex-1"></ul></ul>`;
        this.heading = this.element.firstElementChild.firstElementChild as HTMLElement;
        this.list = this.heading.nextElementSibling as HTMLElement;
        this.heading.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                this.heading.click();
            }
        });
        sourceTree.before(this.element);
        this.docTree = new DocTreeController({
            element: this.list, renderRow: item => this.renderRow(item),
            onSelectionChange: () => {
                if (this.docTree.getSelectedItems().length) { getDocTreeController(this.sourceTree)?.clearSelection(); }
            },
            onExpansionChange: () => this.saveState(),
            onSelectionProgress: this.selectionProgress.update,
        });
        this.initialState = this.readState();
        this.setCollapsed(this.initialState.collapsed);
        this.element.addEventListener("click", event => this.click(event));
        this.element.addEventListener("contextmenu", event => this.contextMenu(event));
        this.element.addEventListener("dragstart", event => {
            this.parentDocClick.cancel();
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (!row || row.dataset.unavailable === "true" || window.siyuan.config.readonly) {
                event.preventDefault();
                return;
            }
            event.stopPropagation();
            this.dragging = true;
            this.docTree.retain(row.dataset.treeKey);
            this.generation++;
            if (!this.docTree.getSelectedItems().some(item => item.occurrenceKey === row.dataset.treeKey)) { this.selectRow(row); }
            const ids = [...new Set(this.docTree.getSelectedItems().map(item => item.id))];
            event.dataTransfer.setData("application/siyuan-pinned-document", row.dataset.nodeId);
            event.dataTransfer.setData(Constants.SIYUAN_DROP_DOCUMENTS, JSON.stringify({ids}));
            event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, ids.join(","));
            event.dataTransfer.effectAllowed = "copyMove";
            this.setDragImage(row, event.dataTransfer);
            this.draggedRow = row;
            row.style.opacity = "0.38";
            this.element.closest(".sy__file")?.classList.add("sy__file--disablehover");
            window.siyuan.dragTitle = row.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
            window.siyuan.dragElement = document.createElement("div");
            window.siyuan.dragElement.innerText = ids.join(",");
        });
        this.element.addEventListener("dragover", event => {
            if (window.siyuan.config.readonly || ![Constants.SIYUAN_DROP_DOCUMENTS, Constants.SIYUAN_DROP_FILE,
                Constants.SIYUAN_DROP_DOCUMENT_TAB].some(type => event.dataTransfer.types.includes(type))) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.previewDrop(event.clientX, event.clientY);
            event.dataTransfer.dropEffect = !this.dropTarget ? "none" : this.dropTarget.position.startsWith("pin") ? "copy" : "move";
        });
        this.element.addEventListener("drop", async event => {
            event.preventDefault();
            event.stopPropagation();
            const rawDocs = event.dataTransfer.getData(Constants.SIYUAN_DROP_DOCUMENTS);
            const docs = rawDocs ? parseDocumentTreeDragData(rawDocs) : undefined;
            const tab = event.dataTransfer.getData(Constants.SIYUAN_DROP_DOCUMENT_TAB);
            const ids = docs?.ids || (tab ? [parseDocumentTabDragData(tab)?.rootId].filter(Boolean) :
                event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(",").filter(id => /^\d{14}-[a-z0-9]{7}$/.test(id)));
            await this.drop(ids, event.clientX, event.clientY);
        });
        this.element.addEventListener("dragleave", event => {
            if (!this.element.contains(event.relatedTarget as Node)) {
                this.clearDrop();
            }
        });
        this.element.addEventListener("dragend", () => {
            this.clearDrop();
            this.dragging = false;
            this.docTree.release();
            if (this.draggedRow) { this.draggedRow.style.opacity = ""; }
            this.draggedRow = undefined;
            this.element.closest(".sy__file")?.classList.remove("sy__file--disablehover");
            window.siyuan.dragElement = undefined;
            window.siyuan.dragTitle = "";
            this.scheduleRefresh();
        });
        sourceTree.addEventListener("dragover", event => {
            if (!event.dataTransfer.types.includes("application/siyuan-pinned-document")) { return; }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.previewDrop(event.clientX, event.clientY, true);
            event.dataTransfer.dropEffect = this.dropTarget ? "move" : "none";
        }, {capture: true, signal: this.sourceEvents.signal});
        sourceTree.addEventListener("drop", event => {
            const id = event.dataTransfer.getData("application/siyuan-pinned-document");
            if (!/^\d{14}-[a-z0-9]{7}$/.test(id)) { return; }
            event.preventDefault();
            event.stopImmediatePropagation();
            const docs = parseDocumentTreeDragData(event.dataTransfer.getData(Constants.SIYUAN_DROP_DOCUMENTS));
            this.drop(docs?.ids || [id], event.clientX, event.clientY, true);
        }, {capture: true, signal: this.sourceEvents.signal});
        sourceTree.addEventListener("dragleave", event => {
            if (this.dragging && !sourceTree.contains(event.relatedTarget as Node)) { this.clearDrop(); }
        }, {capture: true, signal: this.sourceEvents.signal});
        this.bindTouch();
        this.refresh();
    }

    public destroy() {
        this.parentDocClick.cancel();
        this.disposed = true;
        this.generation++;
        window.clearTimeout(this.refreshTimer);
        this.cancelTouch();
        this.sourceEvents.abort();
        this.docTree.destroy();
        this.selectionProgress.destroy();
    }

    public scheduleRefresh() {
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, 100);
    }

    public collapse() {
        this.parentDocClick.cancel();
        this.docTree.collapseAll();
        this.setCollapsed(true);
        this.saveState();
    }

    private getDocIconLabel(subFileCount: number) {
        if (this.mobile) {
            return subFileCount > 0 ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument;
        }
        return window.siyuan.config.fileTree.docIconClickMode === 1 ? "" : window.siyuan.languages.changeIcon;
    }

    public updateDocActions() {
        // 直接更新现有图标提示，保留展开状态并避开文档快照缓存。
        this.list.querySelectorAll<HTMLElement>("[data-pin-row]").forEach(row => {
            const icon = row.querySelector<HTMLElement>(".b3-list-item__icon");
            if (!icon) { return; }
            const label = this.getDocIconLabel(Number(row.dataset.count));
            icon.classList.toggle("ariaLabel", Boolean(label));
            if (label) {
                icon.setAttribute("aria-label", label);
            } else {
                icon.removeAttribute("aria-label");
            }
        });
    }

    private setCollapsed(collapsed: boolean, animate = false) {
        setFileTreeVisibility(this.list, !collapsed, animate);
        this.heading.setAttribute("aria-expanded", String(!collapsed));
        this.heading.querySelector("svg").classList.toggle("b3-list-item__arrow--open", !collapsed);
    }

    public async refresh() {
        this.parentDocClick.cancel();
        if (this.disposed || window.siyuan.isPublish || this.dragging || this.touch?.dragging) { return; }
        const generation = ++this.generation;
        const response = await fetchSyncPost("/api/filetree/getPinnedDocs", {});
        if (response.code !== 0 || generation !== this.generation || this.disposed) { return; }
        pinnedDocIDs.clear();
        response.data.forEach(doc => pinnedDocIDs.add(doc.id));
        this.docTree.setRoots(response.data.map(doc => ({
            id: doc.id, notebookId: doc.notebook, path: doc.path, name: doc.name,
            kind: "document", occurrenceKey: "pin:" + doc.id, subFileCount: doc.subFileCount,
            unavailable: doc.unavailable, childrenSortMode: doc.childrenSortMode,
            effectiveSortMode: window.siyuan.notebooks.find(notebook => notebook.id === doc.notebook)?.sortMode ?? 15,
            file: {id: doc.id, name: doc.name, path: doc.path, icon: doc.icon, subFileCount: doc.subFileCount,
                childrenSortMode: doc.childrenSortMode, count: 0, name1: doc.name1 || "", alias: doc.alias || "",
                memo: doc.memo || "", bookmark: doc.bookmark || "", hSize: doc.hSize || "",
                hMtime: doc.hMtime || "", hCtime: doc.hCtime || ""},
        })));
        this.element.classList.toggle("fn__none", response.data.length === 0);
        if (!this.restored) {
            this.restored = true;
            this.restoring = true;
            const state = this.initialState;
            this.setCollapsed(state.collapsed);
            const expansions: IDocTreeExpansion[] = [];
            for (const key of state.expanded) {
                const ids = key.replace(/^pin:/, "").split("/");
                const root = response.data.find(doc => doc.id === ids[0] && !doc.unavailable);
                if (!root || window.siyuan.notebooks.find(notebook => notebook.id === root.notebook)?.encrypted) { continue; }
                expansions.push({occurrenceKey: key.startsWith("pin:") ? key : "pin:" + key,
                    notebookId: root.notebook, id: ids[ids.length - 1], kind: "document", path: ""});
            }
            try { await this.docTree.restoreExpanded(expansions); }
            finally { this.restoring = false; }
            if (generation === this.generation) { this.saveState(); }
        }
    }

    private readState(): {version: 2, expanded: string[], collapsed: boolean} {
        const saved = window.siyuan.storage[Constants.LOCAL_PINNED_DOC_TREE_STATE];
        if (saved?.version === 2 && Array.isArray(saved.expanded)) {
            return saved;
        }
        let expanded: string[] = [];
        let collapsed = false;
        try {
            expanded = JSON.parse(localStorage.getItem("siyuan-pinned-docs-expanded") || "[]");
            collapsed = localStorage.getItem("siyuan-pinned-docs-collapsed") === "true";
        } catch (error) { console.warn("Failed to migrate pinned document state", error); }
        return {version: 2, expanded: Array.isArray(expanded) ? expanded.filter(key => typeof key === "string") : [], collapsed};
    }

    private saveState() {
        if (this.restoring || !this.restored) { return; }
        const state = {version: 2, collapsed: this.heading.getAttribute("aria-expanded") !== "true",
            expanded: this.docTree.getExpandedItems().filter(item =>
                !window.siyuan.notebooks.find(notebook => notebook.id === item.notebookId)?.encrypted)
                .map(item => item.occurrenceKey)};
        window.siyuan.storage[Constants.LOCAL_PINNED_DOC_TREE_STATE] = state;
        setStorageVal(Constants.LOCAL_PINNED_DOC_TREE_STATE, state);
    }

    private renderRow(item: IDocTreeItem): HTMLElement {
        const doc = {...item.file, notebook: item.notebookId, unavailable: item.unavailable};
        const key = item.occurrenceKey;
        const depth = item.depth;
        const row = document.createElement("li");
        row.className = "b3-list-item b3-list-item--hide-action";
        row.dataset.pinRow = key;
        row.dataset.pinRoot = String(depth === 0);
        row.dataset.nodeId = doc.id;
        row.dataset.notebook = doc.notebook;
        row.dataset.sortmode = String(window.siyuan.notebooks.find(notebook => notebook.id === doc.notebook)?.sortMode ?? 15);
        row.dataset.path = doc.path;
        row.dataset.name = doc.name;
        row.dataset.count = String(doc.subFileCount);
        row.dataset.type = "navigation-file";
        row.setAttribute(FILE_TREE_CHILDREN_SORT_MODE, doc.childrenSortMode?.toString() || "");
        row.dataset.unavailable = String(Boolean(doc.unavailable));
        row.draggable = !this.mobile && !doc.unavailable && !window.siyuan.config.readonly;
        row.tabIndex = 0;
        const paddingLeft = (depth + 1) * (this.mobile ? 20 : 18);
        row.style.setProperty("--file-toggle-width", `${paddingLeft + 18}px`);
        row.style.setProperty("--file-action-offset", `${paddingLeft + 20}px`);
        row.setAttribute("aria-disabled", String(Boolean(doc.unavailable)));
        if (doc.subFileCount) { row.setAttribute("aria-expanded", "false"); }
        // 桌面端点击会修改图标时给出提示，移动端保留无障碍标签
        const iconLabel = this.getDocIconLabel(doc.subFileCount);
        const ariaLabel = doc.unavailable || !doc.hSize ? escapeTooltipTextAttr(doc.name +
            (doc.unavailable ? ` (${window.siyuan.languages.closeNotebook})` : "")) : genFileTreeDocAriaLabel(doc, true);
        if (!doc.icon) { row.dataset.defaultIcon = doc.subFileCount ? "folder" : "file"; }
        row.innerHTML = `<span data-pin-toggle="true" style="padding-left:${paddingLeft}px" class="b3-list-item__toggle b3-list-item__toggle--hl${doc.subFileCount ? "" : " fn__hidden"}"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__icon${iconLabel ? " ariaLabel" : ""}" data-position="8east"${iconLabel ? ` aria-label="${iconLabel}"` : ""}>${getFileTreeIconHTML(doc.icon, doc.subFileCount ? "folder" : "file")}</span><span class="b3-list-item__text ariaLabel" data-delay="200" data-position="parentE" data-tooltip-encoding="none" aria-label="${ariaLabel}">${escapeHtml(doc.name)}${doc.unavailable ? ` (${window.siyuan.languages.closeNotebook})` : ""}</span><span data-pin-more="true" data-menu="true" class="b3-list-item__action" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>`;
        if (!doc.unavailable && !window.siyuan.config.readonly) {
            const add = document.createElement("span");
            add.className = "b3-list-item__action";
            add.dataset.pinNew = "true";
            add.setAttribute("aria-label", window.siyuan.languages.newSubDoc);
            add.innerHTML = '<svg><use xlink:href="#iconAdd"></use></svg>';
            row.append(add);
        }
        row.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (!doc.unavailable) { this.open(doc.id, doc.notebook); }
            } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                event.stopPropagation();
                this.toggle(row, event.key === "ArrowRight");
            }
        });
        return row;
    }





    private async toggle(row: HTMLElement, expand?: boolean) {
        this.parentDocClick.cancel();
        if (row.dataset.unavailable === "true" || row.dataset.count === "0") { return; }
        const item = this.docTree.getItemFromElement(row);
        if (item) { await this.docTree.toggle(item.occurrenceKey, expand); }
    }

    public clearSelection() { this.docTree.clearSelection(); }

    private selectRow(row: HTMLElement) {
        const item = this.docTree.getItemFromElement(row);
        if (item) { void this.docTree.select(item.occurrenceKey, {scroll: false}); }
    }

    private click(event: MouseEvent) {
        event.stopPropagation();
        if (this.suppressClick) { event.preventDefault(); return; }
        const target = event.target as Element;
        globalClickHideMenu(target as HTMLElement);
        if (!target.closest(".b3-list-item__text") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            this.parentDocClick.cancel();
        }
        if (target.closest("[data-pin-heading]")) {
            this.parentDocClick.cancel();
            const collapsed = this.heading.getAttribute("aria-expanded") === "true";
            this.setCollapsed(collapsed, true);
            this.saveState();
            return;
        }
        const row = target.closest<HTMLElement>("[data-pin-row]");
        if (!row) { return; }
        if (isOnlyMeta(event) && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            const item = this.docTree.getItemFromElement(row);
            if (item) { void this.docTree.select(item.occurrenceKey, {toggle: true, scroll: false}); }
            return;
        }
        const moreButton = target.closest("[data-pin-more]");
        if (moreButton) {
            toggleMenu({
                target: moreButton, build: () => {
                    const rect = moreButton.getBoundingClientRect();
                    this.menu(row, {x: rect.left, y: rect.bottom, h: rect.height});
                }
            });
        } else if (target.closest("[data-pin-new]")) {
            newFileInTree(this.app, row.dataset.notebook, row.dataset.path);
        } else if (target.closest("[data-pin-toggle]")) {
            this.toggle(row);
        } else if (target.closest(".b3-list-item__icon") && row.dataset.unavailable !== "true") {
            if (this.mobile || window.siyuan.config.fileTree.docIconClickMode === 1) {
                this.selectRow(row);
                if (Number(row.dataset.count) > 0) { this.toggle(row); } else { this.open(row.dataset.nodeId, row.dataset.notebook); }
            } else if (!window.siyuan.config.readonly) {
                const icon = target.closest<HTMLElement>(".b3-list-item__icon");
                const rect = icon.getBoundingClientRect();
                openEmojiPanel(row.dataset.nodeId, "doc", {x: rect.left, y: rect.bottom, h: rect.height, w: rect.width},
                    undefined, icon.querySelector("img"));
            }
        } else if (row.dataset.unavailable !== "true") {
            this.selectRow(row);
            if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 && Number(row.dataset.count) > 0) {
                if (!target.closest(".b3-list-item__text") ||
                    event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
                    window.siyuan.config.fileTree.parentDocTitleClickMode !== 2) {
                    this.toggle(row);
                    return;
                }
                this.parentDocClick.click(row, async () => {
                    const generation = this.generation;
                    const path = row.dataset.path;
                    const key = row.dataset.treeKey;
                    const expanded = this.docTree.isExpanded(key);
                    if (!expanded) { await this.docTree.itemAtDirectoryIndex(key, 0); }
                    return () => {
                        if (generation !== this.generation || row.dataset.path !== path ||
                            this.docTree.isExpanded(key) !== expanded ||
                            window.siyuan.config.fileTree.parentDocTitleClickMode !== 2) { return; }
                        void this.toggle(row, !expanded);
                    };
                }, () => this.open(row.dataset.nodeId, row.dataset.notebook));
                return;
            }
            this.parentDocClick.cancel();
            this.open(row.dataset.nodeId, row.dataset.notebook);
        }
    }

    private menu(row: HTMLElement, position: IPosition) {
        if (row.dataset.unavailable === "true") {
            const menu = window.siyuan.menus.menu;
            menu.remove();
            menu.element.setAttribute("data-name", Constants.MENU_DOC_TREE_MORE);
            menu.element.setAttribute("data-from", Constants.MENU_FROM_DOC_TREE_MORE_DOC);
            if (!window.siyuan.config.readonly) {
                menu.append(new MenuItem({
                    id: "unpinDoc",
                    label: window.siyuan.languages.unpinDoc,
                    icon: "iconUnpin",
                    click: () => { updatePinnedDocs([row.dataset.nodeId], "unpin"); },
                }).element);
                if (this.mobile) { menu.fullscreen("bottom"); } else { menu.popup(position); }
            }
            return;
        }
        const menu = initFileMenu(this.app, row.dataset.notebook, row.dataset.path, row);
        if (this.mobile) { menu.fullscreen("bottom"); } else { menu.popup(position); }
    }

    private setDragImage(row: HTMLElement, dataTransfer: DataTransfer) {
        const ghost = document.createElement("ul");
        ghost.className = "b3-list b3-list--background";
        ghost.style.cssText = "width:219px;position:fixed;top:-30px";
        ghost.append(row.cloneNode(true));
        document.body.append(ghost);
        setDragTipGhost(ghost, 16, 16);
        dataTransfer.setDragImage(ghost, 16, 16);
        if (window.siyuan.touchDragActive) {
            window.siyuan.touchDragGhost = ghost;
        } else {
            window.setTimeout(() => ghost.remove());
        }
    }

    public previewDrop(x: number, y: number, allowSource = false) {
        this.clearDrop(false);
        const rejectDrop = () => { hideDragTip(); return false; };
        const target = document.elementFromPoint(x, y);
        if (!target || window.siyuan.config.readonly) { return rejectDrop(); }
        const source = allowSource && this.sourceTree.contains(target);
        if (!this.element.contains(target) && !source) { return rejectDrop(); }
        const row = target.closest<HTMLElement>(source ? "li[data-type]" : "[data-pin-row]");
        if (source && (!row || row.closest("[data-encrypted=true]"))) { return rejectDrop(); }
        if (!row) {
            if (!target.closest("[data-pin-heading]")) { return rejectDrop(); }
            this.dropTarget = {id: "", position: "pin-before"};
            this.heading.classList.add("dragover");
        } else {
            if (row.dataset.unavailable === "true") { return rejectDrop(); }
            const rect = row.getBoundingClientRect();
            const position = source && row.dataset.type === "navigation-root" ? "inside" :
                getPinnedDropPosition(row.dataset.pinRoot === "true", (y - rect.top) / rect.height);
            const id = source && row.dataset.type === "navigation-root" ?
                row.dataset.notebookId : row.dataset.nodeId;
            const draggedIDs = this.touch ? [this.touch.id] :
                (window.siyuan.dragElement?.innerText || this.draggedRow?.dataset.nodeId || "").split(",");
            if (!id || draggedIDs.includes(id)) { return rejectDrop(); }
            this.dropTarget = {id, position};
            row.classList.add(position === "inside" ? "dragover" : position.endsWith("before") ? "dragover__top" : "dragover__bottom");
        }
        const name = row?.querySelector(".b3-list-item__text")?.textContent || "";
        const position = this.dropTarget.position;
        const action = position.startsWith("pin") ? window.siyuan.languages.pinDoc :
            (position === "inside" ? window.siyuan.languages.dragTipMoveChild :
                position === "before" ? window.siyuan.languages.dragTipMoveBefore : window.siyuan.languages.dragTipMoveAfter);
        showDragTip(window.siyuan.dragTitle || "", action, x, y, name);
        const scrollElement = source ? this.sourceTree : this.list;
        dragOverScroll({clientY: y} as MouseEvent, scrollElement.getBoundingClientRect(), scrollElement);
        return true;
    }

    public clearDrop(hideTip = true) {
        if (hideTip) { hideDragTip(); }
        this.dropTarget = undefined;
        this.element.querySelectorAll(".dragover, .dragover__top, .dragover__bottom").forEach(row =>
            row.classList.remove("dragover", "dragover__top", "dragover__bottom"));
        if (this.dragging || this.touch?.dragging) {
            this.sourceTree.querySelectorAll(".dragover, .dragover__top, .dragover__bottom").forEach(row =>
                row.classList.remove("dragover", "dragover__top", "dragover__bottom"));
        }
        stopScrollAnimation();
    }

    public async drop(ids: string[], x: number, y: number, allowSource = false) {
        this.previewDrop(x, y, allowSource);
        const target = this.dropTarget;
        this.clearDrop();
        if (!target || !ids.length) { return; }
        if (target.position.startsWith("pin")) {
            await updatePinnedDocs(ids, "pin", target.id, target.position === "pin-after");
        } else if (!ids.includes(target.id)) {
            if (target.position === "inside") {
                await fetchSyncPost("/api/filetree/moveDocsByID", {fromIDs: ids, toID: target.id});
            } else {
                await reorderSortedFileTree(ids, target.id, target.position === "after");
            }
        }
        this.scheduleRefresh();
    }

    private contextMenu(event: MouseEvent) {
        this.parentDocClick.cancel();
        event.stopPropagation();
        const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
        if (row) {
            event.preventDefault();
            // 触摸长按由拖拽处理，避免弹出菜单中断手势。
            if (this.touch || this.suppressClick) { return; }
            const rect = row.getBoundingClientRect();
            this.menu(row, {x: event.clientX, y: rect.bottom, h: rect.height});
        }
    }

    private cancelTouch() {
        this.docTree?.release();
        this.clearDrop();
        if (this.touch) {
            window.clearTimeout(this.touch.timer);
            this.touch.ghost?.remove();
            this.touch = undefined;
        }
    }

    private bindTouch() {
        this.element.addEventListener("touchstart", event => {
            this.cancelTouch();
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (!row || row.dataset.unavailable === "true" || window.siyuan.config.readonly || event.touches.length !== 1) { return; }
            const touch = event.touches[0];
            const state = {id: row.dataset.nodeId, x: touch.clientX, y: touch.clientY, timer: 0, dragging: false, ghost: undefined as HTMLElement};
            this.touch = state;
            state.timer = window.setTimeout(() => {
                if (this.touch !== state) { return; }
                state.dragging = true;
                this.docTree.retain(row.dataset.treeKey);
                state.ghost = document.createElement("ul");
                state.ghost.className = "b3-list b3-list--background";
                state.ghost.append(row.cloneNode(true));
                state.ghost.style.cssText = `background-color:var(--b3-theme-surface);width:100%;touch-action:none;pointer-events:none;margin-left:-50%;margin-top:20px;z-index:${window.siyuan.zIndex};position:fixed;left:${state.x}px;top:${state.y}px`;
                document.body.append(state.ghost);
                this.suppressClick = true;
            }, Constants.TIMEOUT_LONGPRESS);
        }, {passive: true});
        this.element.addEventListener("touchmove", event => {
            if (!this.touch) { return; }
            if (this.touch.dragging) { event.stopPropagation(); }
            if (event.touches.length !== 1) { this.cancelTouch(); return; }
            const touch = event.touches[0];
            if (!this.touch.dragging) {
                if (Math.abs(touch.clientX - this.touch.x) + Math.abs(touch.clientY - this.touch.y) > 8) { this.cancelTouch(); }
                return;
            }
            event.preventDefault();
            this.touch.ghost.style.left = `${touch.clientX}px`;
            this.touch.ghost.style.top = `${touch.clientY}px`;
            this.previewDrop(touch.clientX, touch.clientY, true);
        }, {passive: false});
        this.element.addEventListener("touchend", event => {
            if (this.touch?.dragging) {
                event.stopPropagation();
                event.preventDefault();
                const touch = event.changedTouches[0];
                this.drop([this.touch.id], touch.clientX, touch.clientY, true);
            }
            this.cancelTouch();
            window.setTimeout(() => { this.suppressClick = false; }, 300);
        });
        this.element.addEventListener("touchcancel", event => {
            if (this.touch?.dragging) { event.stopPropagation(); }
            this.cancelTouch();
        });
    }
}
