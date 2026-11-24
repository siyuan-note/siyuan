import {Constants, TAG_SORT_MANUAL} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {fetchSyncPost} from "../../util/fetch";
import {getTreeItemTailHTML} from "../../util/treeItemTail";
import {getDocTreeWindow} from "./docTree/DocTreeModel";
import {filterTagData, getTagFilterKeywords} from "./tagFilter";

interface ITagRow {
    label: string;
    item: IBlockTree;
    siblings: IBlockTree[];
    index: number;
}

interface ITagDrop {
    label: string;
    position: "before" | "after";
}

export class TagTree {
    private readonly list: HTMLUListElement;
    private readonly observer: ResizeObserver;
    private readonly nodes = new Map<string, HTMLLIElement>();
    private readonly markup = new WeakMap<HTMLLIElement, string>();
    private readonly collapsed = new Set<string>();
    private readonly filterCollapsed = new Set<string>();
    private data: IBlockTree[] = [];
    private rows: ITagRow[] = [];
    private byLabel = new Map<string, ITagRow>();
    private measuredRow: HTMLLIElement;
    private rowHeight: number;
    private sort: number;
    private filterValue = "";
    private filterScroll = 0;
    private request: Promise<void>;
    private pending = false;
    private moving = false;
    private disposed = false;
    private selected: string;
    private drag: {source: ITagRow; x: number; y: number; ghost?: HTMLElement};
    private drop: ITagDrop;
    private dragFrame = 0;

    constructor(private readonly options: {
        element: HTMLElement;
        input: HTMLInputElement;
        mobile?: boolean;
        open: (label: string) => void;
        menu: (element: HTMLElement, event: MouseEvent, label: string) => void;
        setLoading: (loading: boolean) => void;
    }) {
        const element = options.element;
        this.rowHeight = options.mobile ? 37 : 30;
        element.classList.add("tag-tree");
        this.list = document.createElement("ul");
        this.list.className = "b3-list b3-list--background tag-tree__list";
        element.append(this.list);
        this.observer = new ResizeObserver(() => this.render());
        this.observer.observe(element);
        element.addEventListener("scroll", () => this.render(), {passive: true});
        element.addEventListener("click", this.click);
        element.addEventListener("contextmenu", this.contextMenu);
        element.addEventListener("keydown", this.keydown);
        element.addEventListener("dragstart", this.startDrag);
        element.addEventListener("dragover", this.moveDrag);
        element.addEventListener("dragleave", this.leaveDrag);
        element.addEventListener("drop", this.endDrag);
        element.addEventListener("dragend", this.cancelDrag);
        this.render();
    }

    public destroy() {
        this.disposed = true;
        this.cancelDrag();
        this.observer.disconnect();
    }

    public async update() {
        if (this.disposed) {
            return;
        }
        this.pending = true;
        this.request ??= this.load().finally(() => { this.request = undefined; });
        return this.request;
    }

    private async load() {
        this.options.setLoading(true);
        try {
            while (this.pending && !this.disposed) {
                this.pending = false;
                const sort = window.siyuan.config.tag.sort;
                const response = await fetchSyncPost("/api/tag/getTag", {
                    sort,
                    app: Constants.SIYUAN_APPID,
                    ignoreMaxListHint: true,
                }).catch((): null => null);
                if (response?.code === 0 && !this.disposed && !this.pending) {
                    this.sort = sort;
                    this.data = response.data || [];
                    this.rebuild();
                }
            }
        } finally {
            this.options.setLoading(false);
        }
    }

    public filter() {
        const value = getTagFilterKeywords(this.options.input.value).join(" ");
        if (value === this.filterValue) {
            return;
        }
        const element = this.options.element;
        if (!this.filterValue) {
            this.filterScroll = element.scrollTop;
        }
        this.filterValue = value;
        this.filterCollapsed.clear();
        this.rebuild(value ? 0 : this.filterScroll);
    }

    public expandAll() {
        this.folded.clear();
        this.rebuild();
    }

    public collapseAll() {
        for (const row of this.byLabel.values()) {
            if (row.item.children?.length) {
                this.folded.add(row.label);
            }
        }
        this.rebuild();
    }

    private get folded() {
        return this.filterValue ? this.filterCollapsed : this.collapsed;
    }

    private get canReorder() {
        return !this.disposed && !this.filterValue && !window.siyuan.config.readonly &&
            this.sort === TAG_SORT_MANUAL && this.sort === window.siyuan.config.tag.sort;
    }

    private rebuild(scroll?: number) {
        this.cancelDrag();
        const element = this.options.element;
        const scrollTop = element.scrollTop;
        const offset = scrollTop % this.rowHeight;
        const anchor = this.rows[Math.floor(scrollTop / this.rowHeight)]?.label;
        this.rows = [];
        this.byLabel.clear();
        const visit = (siblings: IBlockTree[], show: boolean) => {
            siblings.forEach((item, index) => {
                const label = Lute.UnEscapeHTMLStr(item.label);
                const row = {item, label, siblings, index};
                this.byLabel.set(label, row);
                if (show) {
                    this.rows.push(row);
                }
                if (item.children?.length) {
                    visit(item.children, show && !this.folded.has(label));
                }
            });
        };
        visit(this.filterValue ? filterTagData(this.data, this.filterValue.split(" ")) : this.data, true);
        const position = this.rows.findIndex(row => row.label === anchor);
        this.render(scroll ?? (position < 0 ? scrollTop : position * this.rowHeight + offset));
    }

    private render(requestedScroll = this.options.element.scrollTop) {
        if (this.disposed) {
            return;
        }
        const element = this.options.element;
        const {start, end, before, after} = getDocTreeWindow(this.rows.length, requestedScroll, element.clientHeight, this.rowHeight);
        const labels = new Set(this.rows.slice(start, end).map(row => row.label));

        for (const [label, node] of this.nodes) {
            const outside = !labels.has(label);
            const retained = outside && this.drag?.source.label === label;
            node.classList.toggle("tag-tree__drag-source", retained);
            if (outside && !retained) {
                node.remove();
                this.nodes.delete(label);
            }
        }
        if (this.rows.length === 0) {
            this.list.style.removeProperty("padding-block-start");
            this.list.style.removeProperty("padding-block-end");
            this.list.innerHTML = '<li class="b3-list--empty">' + window.siyuan.languages.emptyContent + "</li>";
            this.measureRow(undefined);
            return;
        }
        this.list.querySelector(".b3-list--empty")?.remove();
        this.list.style.paddingBlockStart = before + "px";
        this.list.style.paddingBlockEnd = after + "px";
        let cursor = this.list.firstElementChild;
        for (let i = start; i < end; i++) {
            const row = this.rows[i];
            const node = this.renderRow(row);
            if (node !== cursor) {
                this.list.insertBefore(node, cursor);
            }
            cursor = node.nextElementSibling;
        }
        if (element.scrollTop !== requestedScroll) {
            element.scrollTop = requestedScroll;
        }
        this.measureRow(this.list.firstElementChild as HTMLLIElement);
        if (this.measuredRow) {
            const style = getComputedStyle(this.measuredRow);
            const height = this.measuredRow.getBoundingClientRect().height;
            const spacing = (parseFloat(style.marginBlockStart) || 0) + (parseFloat(style.marginBlockEnd) || 0);
            if (height > 0 && Math.abs(this.rowHeight - height - spacing) > 0.1) {
                const position = element.scrollTop / this.rowHeight;
                this.rowHeight = height + spacing;
                this.render(position * this.rowHeight);
            }
        }
    }

    private measureRow(row: HTMLLIElement) {
        if (row !== this.measuredRow) {
            if (this.measuredRow) {
                this.observer.unobserve(this.measuredRow);
            }
            this.measuredRow = row;
            if (row) {
                this.observer.observe(row);
            }
        }
    }

    private renderRow(row: ITagRow) {
        const {item, label, siblings} = row;
        let node = this.nodes.get(label);
        if (!node) {
            node = document.createElement("li");
            node.dataset.label = label;
            node.dataset.treetype = "tag";
            node.className = "b3-list-item file-tree__row";
            this.nodes.set(label, node);
        }
        const mobile = this.options.mobile;
        const expandable = !!item.children?.length;
        const open = expandable && !this.folded.has(label);
        const sortable = this.canReorder && siblings.length > 1;
        node.classList.toggle("b3-list-item--hide-action", !mobile);
        if (sortable && !node.hasAttribute("tabindex")) {
            node.draggable = true;
            node.tabIndex = 0;
        } else if (!sortable) {
            node.removeAttribute("draggable");
            node.removeAttribute("tabindex");
        }
        const menu = window.siyuan.config.readonly ? "" :
            '<span class="b3-list-item__action" data-tag-menu><svg><use xlink:href="#iconMore"></use></svg></span>';
        const count = item.count ? '<span class="counter">' + item.count + "</span>" : "";
        const text = '<span class="b3-list-item__text ariaLabel" data-position="parentE">' + escapeHtml(item.name) + "</span>";
        const arrowClass = "b3-list-item__arrow" + (open ? " b3-list-item__arrow--open" : "");
        const html = '<span class="b3-list-item__toggle' + (expandable ? " b3-list-item__toggle--hl" : " fn__hidden") + '">' +
            '<svg class="' + arrowClass + '"><use xlink:href="#iconRight"></use></svg></span>' +
            '<svg class="b3-list-item__graphic"><use xlink:href="#iconTag"></use></svg>' +
            text + getTreeItemTailHTML(count, menu, mobile);
        if (this.markup.get(node) !== html) {
            node.innerHTML = html;
            this.markup.set(node, html);
        }
        node.style.setProperty("--file-tree-depth", String(item.depth));
        node.classList.toggle("b3-list-item--focus", this.selected === label);
        node.classList.toggle("dragover__top", this.drop?.label === label && this.drop.position === "before");
        node.classList.toggle("dragover__bottom", this.drop?.label === label && this.drop.position === "after");
        return node;
    }

    private getRow(target: Element) {
        const node = target?.closest<HTMLLIElement>("li[data-label]");
        return node && this.list.contains(node) ? node : undefined;
    }

    private click = (event: MouseEvent) => {
        const target = event.target as Element;
        const node = this.getRow(target);
        if (!node) {
            return;
        }
        const label = node.dataset.label;
        if (target.closest(".b3-list-item__toggle--hl") && !window.siyuan.ctrlIsPressed && !window.siyuan.altIsPressed) {
            this.selected = label;
            if (!this.folded.delete(label)) {
                this.folded.add(label);
            }
            this.rebuild();
            event.preventDefault();
        } else if (target.closest("[data-tag-menu]")) {
            this.options.menu(node, event, label);
            event.preventDefault();
            event.stopPropagation();
        } else {
            this.selected = label;
            this.render();
            this.options.open(label);
        }
    };

    private contextMenu = (event: MouseEvent) => {
        const node = this.getRow(event.target as Element);
        if (node && !window.siyuan.config.readonly && !this.drag) {
            this.options.menu(node, event, node.dataset.label);
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && this.drag) {
            this.cancelDrag();
            event.stopPropagation();
            return;
        }
        const target = event.target as Element;
        const node = this.getRow(target);
        if (!this.canReorder || node !== target || !node?.hasAttribute("tabindex") || !["ArrowUp", "ArrowDown"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const source = this.byLabel.get(node.dataset.label);
        const before = event.key === "ArrowUp";
        const sibling = source?.siblings[source.index + (before ? -1 : 1)];
        if (sibling) {
            void this.commitMove(source.label, {label: Lute.UnEscapeHTMLStr(sibling.label), position: before ? "before" : "after"}, true);
        }
    };

    private startDrag = (event: DragEvent) => {
        const node = this.getRow(event.target as Element);
        if (this.drag || this.moving || !this.canReorder || !node?.draggable || !event.dataTransfer) {
            event.preventDefault();
            return;
        }
        this.drag = {source: this.byLabel.get(node.dataset.label), x: event.clientX, y: event.clientY};
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-siyuan-tag", node.dataset.label);
        window.getSelection()?.removeAllRanges();
        if (window.siyuan.touchDragActive) {
            const ghost = document.createElement("ul");
            ghost.className = this.list.className;
            ghost.style.cssText = `position: fixed; top: -10000px; width: ${node.offsetWidth}px`;
            const preview = node.cloneNode(true) as HTMLElement;
            preview.removeAttribute("draggable");
            preview.removeAttribute("tabindex");
            ghost.append(preview);
            document.body.append(ghost);
            this.drag.ghost = ghost;
            window.siyuan.touchDragGhost = ghost;
            this.updateDrop();
            this.dragFrame = requestAnimationFrame(this.scrollDrag);
        }
    };

    private moveDrag = (event: DragEvent) => {
        if (!this.drag) {
            return;
        }
        this.drag.x = event.clientX;
        this.drag.y = event.clientY;
        this.updateDrop();
        event.stopPropagation();
        if (this.drop && this.canReorder) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
        }
        if (!this.dragFrame) {
            this.dragFrame = requestAnimationFrame(this.scrollDrag);
        }
    };

    private leaveDrag = (event: DragEvent) => {
        if (!this.drag || this.options.element.contains(event.relatedTarget as Node)) {
            return;
        }
        cancelAnimationFrame(this.dragFrame);
        this.dragFrame = 0;
        this.drop = undefined;
        this.render();
    };

    private scrollDrag = () => {
        this.dragFrame = 0;
        const drag = this.drag;
        if (!drag || !this.options.element.isConnected) {
            this.cancelDrag();
            return;
        }
        const element = this.options.element;
        const rect = element.getBoundingClientRect();
        if (rect.left <= drag.x && drag.x <= rect.right) {
            const edge = Math.min(40, rect.height / 3);
            const distance = drag.y - rect.top < edge ? drag.y - rect.top - edge :
                drag.y - rect.bottom > -edge ? drag.y - rect.bottom + edge : 0;
            const scroll = element.scrollTop;
            if (distance !== 0) {
                element.scrollTop = scroll + Math.max(-24, Math.min(24, distance / 3));
            }
            if (element.scrollTop !== scroll) {
                this.render();
                this.updateDrop();
                this.dragFrame = requestAnimationFrame(this.scrollDrag);
            }
        }
    };

    private updateDrop() {
        const {source, x, y} = this.drag;
        const node = this.getRow(document.elementFromPoint(x, y));
        const target = this.byLabel.get(node?.dataset.label);
        const previous = this.drop;
        this.drop = undefined;
        if (target && target !== source && target.siblings === source.siblings) {
            const rect = node.getBoundingClientRect();
            this.drop = {label: target.label, position: y < rect.top + rect.height / 2 ? "before" : "after"};
        }
        if (this.drop?.label !== previous?.label || this.drop?.position !== previous?.position) {
            this.render();
        }
    }

    private endDrag = (event: DragEvent) => {
        if (!this.drag) {
            return;
        }
        this.moveDrag(event);
        const {source} = this.drag;
        const drop = this.drop;
        this.cancelDrag();
        if (drop) {
            event.preventDefault();
            void this.commitMove(source.label, drop);
        }
    };

    private cancelDrag = () => {
        if (!this.drag) {
            return;
        }
        this.drag.ghost?.remove();
        this.drag = undefined;
        this.drop = undefined;
        cancelAnimationFrame(this.dragFrame);
        this.dragFrame = 0;
        this.render();
    };

    private async commitMove(label: string, drop: ITagDrop, focus = false) {
        if (this.moving || !this.canReorder) {
            return;
        }
        this.moving = true;
        try {
            await fetchSyncPost("/api/tag/reorderTag", {label, target: drop.label, position: drop.position}).catch((): null => null);
            await this.update();
            if (focus && this.canReorder) {
                const position = this.rows.findIndex(row => row.label === label);
                if (position >= 0 && !this.nodes.has(label)) {
                    this.render(position * this.rowHeight);
                }
                this.nodes.get(label)?.focus();
            }
        } finally {
            this.moving = false;
        }
    }
}
