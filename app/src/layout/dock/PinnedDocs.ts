import type {App} from "../../index";
import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {pinnedDocIDs, updatePinnedDocs} from "../../util/pinnedDocs";
import {getPinnedDropPosition} from "../../util/pinnedDocsDrop";
import {getFileTreeIconHTML} from "../../emoji/fileTreeIcon";
import {escapeHtml} from "../../util/escape";
import {initFileMenu} from "../../menus/navigation";
import {parseDocumentTabDragData, parseDocumentTreeDragData} from "../../util/fileTreeMove";
import {reorderSortedFileTree} from "../../util/fileTreeReorder";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {MenuItem} from "../../menus/Menu";
import {newFileInTree} from "../../util/newFile";
import {FILE_TREE_CHILDREN_SORT_MODE, FILE_TREE_EFFECTIVE_SORT_MODE} from "../../util/fileTreeSort";
import {getConfiguredEntryVisibility, setEntryVisibilityValue} from "../../config/entryVisibility/runtime";

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
    private expanded = new Set<string>();
    private generation = 0;
    private refreshTimer: number;
    private disposed = false;
    private dropTarget: {id: string, position: ReturnType<typeof getPinnedDropPosition>} | undefined;
    private touch: {id: string, x: number, y: number, timer: number, dragging: boolean, ghost?: HTMLElement};
    private suppressClick = false;
    private dragging = false;
    private sourceEvents = new AbortController();
    private names = new Map<string, string>();

    constructor(private app: App, private sourceTree: HTMLElement, private open: (id: string, notebook: string) => void,
                private mobile = false) {
        this.element = document.createElement("div");
        this.element.className = "file-tree__pins b3-list--background fn__flex-column";
        this.element.style.cssText = "flex-shrink:0;max-height:40%;min-height:30px;overflow:hidden;border-bottom:1px solid var(--b3-border-color)";
        this.element.innerHTML = `<button class="b3-list-item" type="button" data-pin-heading="true"><span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__text">${window.siyuan.languages.pinnedDocs}</span></button><div class="fn__flex-1" style="overflow:auto;min-height:0"><ul class="b3-list"></ul></div>`;
        this.list = this.element.lastElementChild.firstElementChild as HTMLElement;
        sourceTree.before(this.element);
        this.applyVisibility();
        window.addEventListener("siyuan-entry-visibility", () => {
            this.applyVisibility();
            this.scheduleRefresh();
        }, {signal: this.sourceEvents.signal});
        try {
            this.expanded = new Set(JSON.parse(localStorage.getItem("siyuan-pinned-docs-expanded") || "[]"));
        } catch (e) {
            console.warn("Failed to read pinned document expansion state", e);
        }
        this.setCollapsed(localStorage.getItem("siyuan-pinned-docs-collapsed") === "true");
        this.element.addEventListener("click", event => this.click(event));
        this.element.addEventListener("contextmenu", event => {
            event.stopPropagation();
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (row) {
                event.preventDefault();
                this.menu(row, event.clientX, event.clientY);
            }
        });
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
        });
        this.element.addEventListener("dragover", event => {
            if (window.siyuan.config.readonly || ![Constants.SIYUAN_DROP_DOCUMENTS, Constants.SIYUAN_DROP_FILE,
                Constants.SIYUAN_DROP_DOCUMENT_TAB].some(type => event.dataTransfer.types.includes(type))) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.previewDrop(event.clientX, event.clientY);
            event.dataTransfer.dropEffect = this.dropTarget?.position.startsWith("pin") ? "copy" : "move";
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
            this.scheduleRefresh();
        });
        sourceTree.addEventListener("dragover", event => {
            if (!event.dataTransfer.types.includes("application/siyuan-pinned-document")) { return; }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.previewDrop(event.clientX, event.clientY, true);
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

    public isVisible() {
        return getConfiguredEntryVisibility("documentPanel.pinnedDocs");
    }

    public toggleVisibility() {
        setEntryVisibilityValue("documentPanel.pinnedDocs", !this.isVisible());
    }

    private applyVisibility() {
        this.element.classList.toggle("fn__none", !this.isVisible());
    }

    public scheduleRefresh() {
        window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => this.refresh(), 150);
    }

    private setCollapsed(collapsed: boolean) {
        this.element.lastElementChild.classList.toggle("fn__none", collapsed);
        this.element.firstElementChild.setAttribute("aria-expanded", String(!collapsed));
        this.element.querySelector("svg").classList.toggle("b3-list-item__arrow--open", !collapsed);
    }

    public async refresh() {
        if (this.disposed || window.siyuan.isPublish || this.dragging || this.touch?.dragging) {
            return;
        }
        const generation = ++this.generation;
        const response = await fetchSyncPost("/api/filetree/getPinnedDocs", {});
        if (response.code !== 0 || generation !== this.generation || this.disposed) {
            return;
        }
        const scroll = this.list.parentElement.scrollTop;
        const focused = this.list.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.pinRow : undefined;
        const selected = new Set(Array.from(this.list.querySelectorAll<HTMLElement>(".b3-list-item--focus"), row => row.dataset.pinRow));
        pinnedDocIDs.clear();
        response.data.forEach(doc => pinnedDocIDs.add(doc.id));
        if (!this.isVisible()) { return; }
        const list = document.createElement("ul");
        for (const doc of response.data) {
            if (doc.unavailable) {
                doc.name = this.names.get(doc.id) || doc.name;
            } else {
                this.names.set(doc.id, doc.name);
            }
            const wrapper = document.createElement("ul");
            wrapper.dataset.url = doc.notebook;
            list.append(wrapper);
            await this.appendDoc(wrapper, doc, doc.id, 0, generation);
        }
        if (generation === this.generation && !this.disposed) {
            this.list.replaceChildren(...Array.from(list.children));
            this.list.querySelectorAll<HTMLElement>("[data-pin-row]").forEach(row => {
                row.classList.toggle("b3-list-item--focus", selected.has(row.dataset.pinRow));
                if (row.dataset.pinRow === focused) { row.focus({preventScroll: true}); }
            });
            this.list.parentElement.scrollTop = scroll;
        }
    }

    private async appendDoc(parent: HTMLElement, doc: IPinnedDoc, key: string, depth: number, generation: number) {
        const row = document.createElement("li");
        row.className = "b3-list-item b3-list-item--hide-action";
        row.dataset.pinRow = key;
        row.dataset.pinRoot = String(depth === 0);
        row.dataset.nodeId = doc.id;
        row.dataset.notebook = doc.notebook;
        row.dataset.path = doc.path;
        row.dataset.name = doc.name;
        row.dataset.count = String(doc.subFileCount);
        row.dataset.type = "navigation-file";
        row.setAttribute(FILE_TREE_CHILDREN_SORT_MODE, doc.childrenSortMode?.toString() || "");
        row.dataset.unavailable = String(Boolean(doc.unavailable));
        row.draggable = !doc.unavailable && !window.siyuan.config.readonly;
        row.tabIndex = 0;
        row.style.paddingLeft = `${depth * (this.mobile ? 20 : 18)}px`;
        row.setAttribute("aria-disabled", String(Boolean(doc.unavailable)));
        if (doc.subFileCount) { row.setAttribute("aria-expanded", "false"); }
        row.innerHTML = `<span data-pin-toggle="true" class="b3-list-item__toggle${doc.subFileCount ? "" : " fn__hidden"}"><svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg></span><span class="b3-list-item__icon">${getFileTreeIconHTML(doc.icon, doc.subFileCount ? "folder" : "file")}</span><span class="b3-list-item__text">${escapeHtml(doc.name)}${doc.unavailable ? ` (${window.siyuan.languages.closeNotebook})` : ""}</span><span data-pin-more="true" class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>`;
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
        parent.append(children);
        if (this.expanded.has(key) && doc.subFileCount && !doc.unavailable) {
            await this.loadChildren(row, children, generation);
        }
    }

    private async loadChildren(row: HTMLElement, children: HTMLElement, generation: number) {
        const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
            notebook: row.dataset.notebook,
            path: row.dataset.nodeId === row.dataset.notebook ? "/" : row.dataset.path,
            maxListCount: 0,
        });
        if (response.code !== 0 || generation !== this.generation || !this.expanded.has(row.dataset.pinRow)) {
            return;
        }
        children.replaceChildren();
        children.setAttribute(FILE_TREE_EFFECTIVE_SORT_MODE, String(response.data.effectiveSortMode));
        for (const doc of response.data.files) {
            await this.appendDoc(children, {...doc, notebook: row.dataset.notebook},
                `${row.dataset.pinRow}/${doc.id}`, row.dataset.pinRow.split("/").length, generation);
        }
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
        } else {
            this.expanded.delete(key);
            row.nextElementSibling.classList.add("fn__none");
            row.querySelector("svg").classList.remove("b3-list-item__arrow--open");
            row.setAttribute("aria-expanded", "false");
        }
        localStorage.setItem("siyuan-pinned-docs-expanded", JSON.stringify([...this.expanded]));
    }

    private click(event: MouseEvent) {
        event.stopPropagation();
        if (this.suppressClick) { event.preventDefault(); return; }
        const target = event.target as Element;
        if (target.closest("[data-pin-heading]")) {
            const collapsed = this.element.firstElementChild.getAttribute("aria-expanded") === "true";
            this.setCollapsed(collapsed);
            localStorage.setItem("siyuan-pinned-docs-collapsed", String(collapsed));
            return;
        }
        const row = target.closest<HTMLElement>("[data-pin-row]");
        if (!row) { return; }
        if (target.closest("[data-pin-more]")) {
            this.menu(row, event.clientX, event.clientY);
        } else if (target.closest("[data-pin-new]")) {
            newFileInTree(this.app, row.dataset.notebook, row.dataset.path);
        } else if (target.closest("[data-pin-toggle]")) {
            this.toggle(row);
        } else if (row.dataset.unavailable !== "true") {
            this.list.querySelectorAll(".b3-list-item--focus").forEach(item => item.classList.remove("b3-list-item--focus"));
            row.classList.add("b3-list-item--focus");
            this.open(row.dataset.nodeId, row.dataset.notebook);
        }
    }

    private menu(row: HTMLElement, x: number, y: number) {
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
                if (this.mobile) { menu.fullscreen("bottom"); } else { menu.popup({x, y}); }
            }
            return;
        }
        const menu = initFileMenu(this.app, row.dataset.notebook, row.dataset.path, row);
        if (this.mobile) { menu.fullscreen("bottom"); } else { menu.popup({x, y}); }
    }

    public previewDrop(x: number, y: number, allowSource = false) {
        this.clearDrop();
        const target = document.elementFromPoint(x, y);
        if (!target || window.siyuan.config.readonly) { return false; }
        const source = allowSource && this.sourceTree.contains(target);
        if (!this.element.contains(target) && !source) { return false; }
        const row = target.closest<HTMLElement>(source ? "li[data-type]" : "[data-pin-row]");
        if (source && (!row || row.closest("[data-encrypted=true]"))) { return false; }
        if (!row) {
            this.dropTarget = {id: "", position: "pin-before"};
            this.element.firstElementChild.classList.add("dragover__bottom");
        } else {
            if (row.dataset.unavailable === "true") { return false; }
            const rect = row.getBoundingClientRect();
            const position = source && row.dataset.type === "navigation-root" ? "inside" :
                getPinnedDropPosition(row.dataset.pinRoot === "true", (y - rect.top) / rect.height);
            this.dropTarget = {id: row.dataset.nodeId || row.dataset.url, position};
            row.classList.add(position === "inside" ? "dragover" : position.endsWith("before") ? "dragover__top" : "dragover__bottom");
        }
        const scrollElement = source ? this.sourceTree : this.list.parentElement;
        dragOverScroll({clientY: y} as MouseEvent, scrollElement.getBoundingClientRect(), scrollElement);
        return true;
    }

    public clearDrop() {
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
            const row = (event.target as Element).closest<HTMLElement>("[data-pin-row]");
            if (!row || row.dataset.unavailable === "true" || window.siyuan.config.readonly || event.touches.length !== 1) { return; }
            this.cancelTouch();
            const touch = event.touches[0];
            const state = {id: row.dataset.nodeId, x: touch.clientX, y: touch.clientY, timer: 0, dragging: false, ghost: undefined as HTMLElement};
            this.touch = state;
            state.timer = window.setTimeout(() => {
                state.dragging = true;
                state.ghost = row.cloneNode(true) as HTMLElement;
                state.ghost.style.cssText = `position:fixed;pointer-events:none;z-index:9999;opacity:.7;left:${state.x}px;top:${state.y}px`;
                document.body.append(state.ghost);
                this.suppressClick = true;
            }, Constants.TIMEOUT_LONGPRESS);
        }, {passive: true});
        this.element.addEventListener("touchmove", event => {
            event.stopPropagation();
            if (!this.touch) { return; }
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
