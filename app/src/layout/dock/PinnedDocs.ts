import type {App} from "../../index";
import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {pinnedDocIDs, updatePinnedDocs} from "../../util/pinnedDocs";
import {getPinnedDropPosition} from "../../util/pinnedDocsDrop";
import {getFileTreeIconHTML} from "../../emoji/fileTreeIcon";
import {openEmojiPanel} from "../../emoji";
import {escapeHtml} from "../../util/escape";
import {initFileMenu} from "../../menus/navigation";
import {parseDocumentTabDragData, parseDocumentTreeDragData} from "../../util/fileTreeMove";
import {reorderSortedFileTree} from "../../util/fileTreeReorder";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {MenuItem} from "../../menus/Menu";
import {newFileInTree} from "../../util/newFile";
import {isOnlyMeta} from "../../protyle/util/compatibility";
import {FILE_TREE_CHILDREN_SORT_MODE, FILE_TREE_EFFECTIVE_SORT_MODE} from "../../util/fileTreeSort";
import {setFileTreeVisibility} from "./fileTreeAnimation";
import {hideDragTip, setDragTipGhost, showDragTip} from "../../protyle/util/dragTip";

interface IPinnedDoc {
    id: string;
    notebook: string;
    name: string;
    path: string;
    icon: string;
    subFileCount: number;
    unavailable?: boolean;
    childrenSortMode?: number | null;
}

// 根入口与子树使用独立容器，避免重复文档干扰源文档树的选择和移动定位。
export class PinnedDocs {
    public element: HTMLElement;
    private list: HTMLElement;
    private heading: HTMLElement;
    private expanded = new Set<string>();
    private generation = 0;
    private refreshTimer: number;
    private disposed = false;
    private dropTarget: {id: string, position: ReturnType<typeof getPinnedDropPosition>} | undefined;
    private touch: {id: string, x: number, y: number, timer: number, dragging: boolean, ghost?: HTMLElement};
    private suppressClick = false;
    private dragging = false;
    private draggedRow: HTMLElement;
    private sourceEvents = new AbortController();
    private names = new Map<string, string>();
    private rootSnapshot: string;
    private dirtyChildren = new Set<string>();
    private refreshAllChildren = false;

    public onFileTreeMessage(data: IWebSocketData) {
        switch (data.cmd) {
            case "pinnedDocsChanged":
                this.scheduleRefresh("");
                break;
            case "rename":
                this.scheduleRefresh(data.data.id);
                break;
            case "moveDocs":
            case "removeDoc":
            case "create":
            case "heading2doc":
            case "createdailynote":
            case "li2doc":
            case "closeBox":
            case "removeBox":
            case "mount":
            case "notebookIconChanged":
            case "renamenotebook":
            case "boxDocFeatureChanged":
                this.scheduleRefresh();
                break;
        }
    }

    constructor(private app: App, private sourceTree: HTMLElement, private open: (id: string, notebook: string) => void,
                private mobile = false) {
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
        try {
            this.expanded = new Set(JSON.parse(localStorage.getItem("siyuan-pinned-docs-expanded") || "[]"));
        } catch (e) {
            console.warn("Failed to read pinned document expansion state", e);
        }
        this.setCollapsed(localStorage.getItem("siyuan-pinned-docs-collapsed") === "true");
        this.element.addEventListener("click", event => this.click(event));
        this.element.addEventListener("contextmenu", event => this.contextMenu(event));
        this.element.addEventListener("dragstart", event => {
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (!row || row.dataset.unavailable === "true" || window.siyuan.config.readonly) {
                event.preventDefault();
                return;
            }
            event.stopPropagation();
            this.dragging = true;
            this.generation++;
            event.dataTransfer.setData("application/siyuan-pinned-document", row.dataset.nodeId);
            event.dataTransfer.setData(Constants.SIYUAN_DROP_DOCUMENTS, JSON.stringify({ids: [row.dataset.nodeId]}));
            event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, row.dataset.nodeId);
            event.dataTransfer.effectAllowed = "copyMove";
            if (!row.classList.contains("b3-list-item--focus")) {
                this.clearSelection();
                row.classList.add("b3-list-item--focus");
            }
            this.setDragImage(row, event.dataTransfer);
            this.draggedRow = row;
            row.style.opacity = "0.38";
            this.element.closest(".sy__file")?.classList.add("sy__file--disablehover");
            window.siyuan.dragTitle = row.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
            window.siyuan.dragElement = document.createElement("div");
            window.siyuan.dragElement.innerText = row.dataset.nodeId;
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
            this.drop([id], event.clientX, event.clientY, true);
        }, {capture: true, signal: this.sourceEvents.signal});
        sourceTree.addEventListener("dragleave", event => {
            if (this.dragging && !sourceTree.contains(event.relatedTarget as Node)) { this.clearDrop(); }
        }, {capture: true, signal: this.sourceEvents.signal});
        this.bindTouch();
        this.refresh();
    }

    public destroy() {
        this.disposed = true;
        this.generation++;
        window.clearTimeout(this.refreshTimer);
        this.cancelTouch();
        this.sourceEvents.abort();
    }

    public scheduleRefresh(changedID?: string) {
        if (changedID === undefined) {
            this.refreshAllChildren = true;
        } else if (changedID) {
            this.list.querySelectorAll<HTMLElement>("[data-pin-row]").forEach(row => {
                if (row.dataset.nodeId === changedID) {
                    const key = row.dataset.pinRow;
                    const separator = key.lastIndexOf("/");
                    if (separator > 0) { this.dirtyChildren.add(key.slice(0, separator)); }
                }
            });
        }
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            const dirty = this.refreshAllChildren ? undefined : this.dirtyChildren;
            this.dirtyChildren = new Set();
            this.refreshAllChildren = false;
            this.refresh(dirty);
        }, 150);
    }

    public collapse() {
        this.generation++;
        this.expanded.clear();
        localStorage.setItem("siyuan-pinned-docs-expanded", "[]");
        localStorage.setItem("siyuan-pinned-docs-collapsed", "true");
        this.setCollapsed(true);
        this.list.querySelectorAll<HTMLElement>("[data-pin-root=true]").forEach(row => {
            row.nextElementSibling.replaceChildren();
            row.nextElementSibling.removeAttribute("data-pin-snapshot");
            row.nextElementSibling.classList.add("fn__none");
            row.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            if (row.hasAttribute("aria-expanded")) { row.setAttribute("aria-expanded", "false"); }
        });
        this.scheduleRefresh();
    }

    private setCollapsed(collapsed: boolean, animate = false) {
        setFileTreeVisibility(this.list, !collapsed, animate);
        this.heading.setAttribute("aria-expanded", String(!collapsed));
        this.heading.querySelector("svg").classList.toggle("b3-list-item__arrow--open", !collapsed);
    }

    public async refresh(dirtyChildren?: Set<string>) {
        if (this.disposed || window.siyuan.isPublish || this.dragging || this.touch?.dragging) {
            return;
        }
        const generation = ++this.generation;
        const response = await fetchSyncPost("/api/filetree/getPinnedDocs", {});
        if (response.code !== 0 || generation !== this.generation || this.disposed) {
            return;
        }
        const scroll = this.list.scrollTop;
        const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.pinRow : undefined;
        const selected = new Set(Array.from(this.list.querySelectorAll<HTMLElement>(".b3-list-item--focus"), row => row.dataset.pinRow));
        pinnedDocIDs.clear();
        response.data.forEach(doc => pinnedDocIDs.add(doc.id));
        const snapshot = JSON.stringify(response.data);
        if (snapshot === this.rootSnapshot) {
            const rows = Array.from(this.list.querySelectorAll<HTMLElement>("[data-pin-row]"));
            for (const row of rows) {
                if (this.expanded.has(row.dataset.pinRow) &&
                    (dirtyChildren ? dirtyChildren.has(row.dataset.pinRow) : row.dataset.pinRoot === "true")) {
                    await this.loadChildren(row, row.nextElementSibling as HTMLElement, generation, !dirtyChildren);
                }
            }
            return;
        }
        const list = document.createElement("ul");
        for (const doc of response.data) {
            if (doc.unavailable) {
                doc.name = this.names.get(doc.id) || doc.name;
            } else {
                this.names.set(doc.id, doc.name);
            }
            await this.appendDoc(list, doc, doc.id, 0, generation);
        }
        if (generation === this.generation && !this.disposed) {
            this.rootSnapshot = snapshot;
            this.list.replaceChildren(...Array.from(list.children));
            this.element.classList.toggle("fn__none", response.data.length === 0);
            this.list.querySelectorAll<HTMLElement>("[data-pin-row]").forEach(row => {
                row.classList.toggle("b3-list-item--focus", selected.has(row.dataset.pinRow));
                if (row.dataset.pinRow === focused) { row.focus({preventScroll: true}); }
            });
            this.list.scrollTop = scroll;
        }
    }

    private async appendDoc(parent: HTMLElement, doc: IPinnedDoc, key: string, depth: number, generation: number) {
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
        const iconExpands = this.mobile || window.siyuan.config.fileTree.docIconClickExpand;
        const iconLabel = iconExpands ? (doc.subFileCount ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument) : window.siyuan.languages.changeIcon;
        if (!doc.icon) { row.dataset.defaultIcon = doc.subFileCount ? "folder" : "file"; }
        row.innerHTML = `<span data-pin-toggle="true" style="padding-left:${paddingLeft}px" class="b3-list-item__toggle b3-list-item__toggle--hl${doc.subFileCount ? "" : " fn__hidden"}"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__icon ariaLabel" data-position="8east" aria-label="${iconLabel}">${getFileTreeIconHTML(doc.icon, doc.subFileCount ? "folder" : "file")}</span><span class="b3-list-item__text">${escapeHtml(doc.name)}${doc.unavailable ? ` (${window.siyuan.languages.closeNotebook})` : ""}</span><span data-pin-more="true" class="b3-list-item__action" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>`;
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
        parent.append(row);
        const children = document.createElement("ul");
        children.className = "fn__none";
        children.dataset.url = doc.notebook;
        children.dataset.sortmode = String(window.siyuan.notebooks.find(notebook => notebook.id === doc.notebook)?.sortMode ?? 15);
        parent.append(children);
        if (this.expanded.has(key) && doc.subFileCount && !doc.unavailable) {
            await this.loadChildren(row, children, generation);
        }
    }

    private async loadChildren(row: HTMLElement, children: HTMLElement, generation: number, refreshDescendants = true) {
        const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
            notebook: row.dataset.notebook,
            path: row.dataset.nodeId === row.dataset.notebook ? "/" : row.dataset.path,
            maxListCount: 0,
        });
        if (response.code !== 0 || generation !== this.generation || !this.expanded.has(row.dataset.pinRow)) {
            return;
        }
        const snapshot = JSON.stringify({sort: response.data.effectiveSortMode, files: response.data.files.map((doc: IFile) => ({
            id: doc.id, name: doc.name, path: doc.path, icon: doc.icon, subFileCount: doc.subFileCount,
            childrenSortMode: doc.childrenSortMode,
        }))});
        if (children.dataset.pinSnapshot === snapshot) {
            if (refreshDescendants) {
                for (const child of Array.from(children.querySelectorAll<HTMLElement>(":scope > [data-pin-row]"))) {
                    if (this.expanded.has(child.dataset.pinRow)) {
                        await this.loadChildren(child, child.nextElementSibling as HTMLElement, generation);
                    }
                }
            }
        } else {
            children.replaceChildren();
            children.setAttribute(FILE_TREE_EFFECTIVE_SORT_MODE, String(response.data.effectiveSortMode));
            for (const doc of response.data.files) {
                await this.appendDoc(children, {...doc, notebook: row.dataset.notebook},
                    `${row.dataset.pinRow}/${doc.id}`, row.dataset.pinRow.split("/").length, generation);
            }
            if (generation !== this.generation || !this.expanded.has(row.dataset.pinRow)) { return; }
            children.dataset.pinSnapshot = snapshot;
        }
        if (generation !== this.generation || !this.expanded.has(row.dataset.pinRow)) { return; }
        children.classList.remove("fn__none");
        row.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
        row.setAttribute("aria-expanded", "true");
    }

    private async toggle(row: HTMLElement, expand = !this.expanded.has(row.dataset.pinRow)) {
        if (row.dataset.unavailable === "true" || row.dataset.count === "0") { return; }
        const key = row.dataset.pinRow;
        if (expand) {
            this.expanded.add(key);
            await this.loadChildren(row, row.nextElementSibling as HTMLElement, this.generation);
            if (this.expanded.has(key)) {
                setFileTreeVisibility(row.nextElementSibling as HTMLElement, true, true);
            }
        } else {
            this.expanded.delete(key);
            setFileTreeVisibility(row.nextElementSibling as HTMLElement, false, true);
            row.querySelector("svg").classList.remove("b3-list-item__arrow--open");
            row.setAttribute("aria-expanded", "false");
        }
        localStorage.setItem("siyuan-pinned-docs-expanded", JSON.stringify([...this.expanded]));
    }

    public clearSelection() {
        this.list.querySelectorAll(".b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
            item.removeAttribute("select-start");
            item.removeAttribute("select-end");
        });
    }

    private selectRow(row: HTMLElement) {
        this.clearSelection();
        this.sourceTree.querySelectorAll(".b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
            item.removeAttribute("select-start");
            item.removeAttribute("select-end");
        });
        row.classList.add("b3-list-item--focus");
    }

    private click(event: MouseEvent) {
        event.stopPropagation();
        if (this.suppressClick) { event.preventDefault(); return; }
        const target = event.target as Element;
        if (target.closest("[data-pin-heading]")) {
            const collapsed = this.heading.getAttribute("aria-expanded") === "true";
            this.setCollapsed(collapsed, true);
            localStorage.setItem("siyuan-pinned-docs-collapsed", String(collapsed));
            return;
        }
        const row = target.closest<HTMLElement>("[data-pin-row]");
        if (!row) { return; }
        if (isOnlyMeta(event) && !event.altKey && !event.shiftKey) {
            event.preventDefault();
            row.classList.toggle("b3-list-item--focus");
            return;
        }
        const moreButton = target.closest("[data-pin-more]");
        if (moreButton) {
            const rect = moreButton.getBoundingClientRect();
            this.menu(row, {x: rect.left, y: rect.bottom, h: rect.height});
        } else if (target.closest("[data-pin-new]")) {
            newFileInTree(this.app, row.dataset.notebook, row.dataset.path);
        } else if (target.closest("[data-pin-toggle]")) {
            this.toggle(row);
        } else if (target.closest(".b3-list-item__icon") && row.dataset.unavailable !== "true") {
            if (this.mobile || window.siyuan.config.fileTree.docIconClickExpand) {
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
            if (window.siyuan.config.fileTree.parentDocClickExpand && Number(row.dataset.count) > 0) {
                this.toggle(row);
                return;
            }
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
                row.closest<HTMLElement>("ul[data-url]")?.dataset.url : row.dataset.nodeId;
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
                position === "before" ? window.siyuan.languages.dragTipMoveBefore : window.siyuan.languages.dragTipMoveAfter)
                .replace("${x}", name);
        showDragTip(window.siyuan.dragTitle || "", action, x, y);
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
        this.clearDrop();
        if (this.touch) {
            window.clearTimeout(this.touch.timer);
            this.touch.ghost?.remove();
            this.touch = undefined;
        }
    }

    private bindTouch() {
        this.element.addEventListener("touchstart", event => {
            event.stopPropagation();
            this.cancelTouch();
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (!row || row.dataset.unavailable === "true" || window.siyuan.config.readonly || event.touches.length !== 1) { return; }
            const touch = event.touches[0];
            const state = {id: row.dataset.nodeId, x: touch.clientX, y: touch.clientY, timer: 0, dragging: false, ghost: undefined as HTMLElement};
            this.touch = state;
            state.timer = window.setTimeout(() => {
                if (this.touch !== state) { return; }
                state.dragging = true;
                state.ghost = document.createElement("ul");
                state.ghost.className = "b3-list b3-list--background";
                state.ghost.append(row.cloneNode(true));
                state.ghost.style.cssText = `background-color:var(--b3-theme-surface);width:100%;touch-action:none;pointer-events:none;margin-left:-50%;margin-top:20px;z-index:${window.siyuan.zIndex};position:fixed;left:${state.x}px;top:${state.y}px`;
                document.body.append(state.ghost);
                this.suppressClick = true;
            }, Constants.TIMEOUT_LONGPRESS);
        }, {passive: true});
        this.element.addEventListener("touchmove", event => {
            event.stopPropagation();
            if (!this.touch) { return; }
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
            event.stopPropagation();
            if (this.touch?.dragging) {
                event.preventDefault();
                const touch = event.changedTouches[0];
                this.drop([this.touch.id], touch.clientX, touch.clientY, true);
            }
            this.cancelTouch();
            window.setTimeout(() => { this.suppressClick = false; }, 300);
        });
        this.element.addEventListener("touchcancel", () => this.cancelTouch());
    }
}
