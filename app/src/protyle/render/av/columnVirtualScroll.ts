export interface IAVColumnWindowColumn {
    id: string;
    width: number;
    pinned?: boolean;
}

export interface IAVColumnWindow {
    columnIDs: Set<string>;
    totalWidth: number;
}

export const getAVColumnWindow = (options: {
    columns: IAVColumnWindowColumn[];
    viewportLeft: number;
    viewportWidth: number;
    leadingWidth?: number;
    occludedWidth?: number;
    buffer?: number;
}): IAVColumnWindow | undefined => {
    if (!Number.isFinite(options.viewportLeft) || !Number.isFinite(options.viewportWidth) ||
        options.viewportWidth <= 0 || options.columns.some(column =>
            !column.id || !Number.isFinite(column.width) || column.width <= 0) ||
        new Set(options.columns.map(column => column.id)).size !== options.columns.length) {
        return;
    }
    const leadingWidth = options.leadingWidth ?? 0;
    const occludedWidth = options.occludedWidth ?? 0;
    const buffer = options.buffer ?? 160;
    if (![leadingWidth, occludedWidth, buffer].every(value => Number.isFinite(value) && value >= 0)) {
        return;
    }
    const left = options.viewportLeft + Math.min(occludedWidth, options.viewportWidth) - buffer;
    const right = options.viewportLeft + options.viewportWidth + buffer;
    let offset = leadingWidth;
    const columnIDs = new Set<string>();
    options.columns.forEach(column => {
        if (column.pinned || offset + column.width > left && offset < right) {
            columnIDs.add(column.id);
        }
        offset += column.width;
    });
    return {columnIDs, totalWidth: offset};
};

interface IAVColumnRow {
    element: HTMLElement;
    cells: HTMLElement[];
    prefix: HTMLElement;
    suffix: HTMLElement;
    mounted: Set<HTMLElement>;
    spacers: HTMLElement[];
    minHeight: string;
    minHeightPriority: string;
    minimum: number;
    signature: string;
}

interface IAVColumnBody {
    columns: IAVColumnWindowColumn[];
    columnIDs: Set<string>;
    signature: string;
}

const getBoxSize = (element: HTMLElement, dimension: "width" | "height") => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    const size = parseFloat(style[dimension]);
    if (style.boxSizing === "border-box") {
        return size;
    }
    const edges = dimension === "width" ?
        [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth] :
        [style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth];
    return edges.reduce((total, edge) => total + (parseFloat(edge) || 0), size);
};

const hasColumnGeometry = (element: HTMLElement) => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display !== "none" && style.order === "0" && parseFloat(style.flexGrow) === 0 &&
        parseFloat(style.flexShrink) === 0 && !(parseFloat(style.marginLeft) || parseFloat(style.marginRight)) &&
        (style.position === "static" || style.position === "relative");
};

const hasRowGeometry = (element: HTMLElement) => {
    const style = element.ownerDocument.defaultView.getComputedStyle(element);
    return style.display === "flex" && style.flexDirection === "row" && style.direction === "ltr" &&
        style.flexWrap === "nowrap" && !(parseFloat(style.columnGap) || parseFloat(style.paddingLeft) ||
            parseFloat(style.paddingRight) || parseFloat(style.borderLeftWidth) || parseFloat(style.borderRightWidth));
};

const hasProtectedContent = (element: HTMLElement) => {
    const document = element.ownerDocument;
    if (element.contains(document.activeElement) ||
        element.querySelector(".av__cell--select, .av__cell--active, .av__drag-fill, [contenteditable=true]")) {
        return true;
    }
    const selection = document.getSelection();
    if (selection && !selection.isCollapsed) {
        for (let index = 0; index < selection.rangeCount; index++) {
            if (selection.getRangeAt(index).intersectsNode(element)) {
                return true;
            }
        }
    }
    return false;
};

export class AVColumnVirtualScroll {
    private readonly rows = new Map<HTMLElement, IAVColumnRow>();
    private readonly cellRows = new WeakMap<HTMLElement, IAVColumnRow>();
    private readonly observer: MutationObserver;
    private readonly fontSet: FontFaceSet;
    private frame = 0;
    private suspended = false;
    private disposed = false;

    constructor(private readonly blockElement: HTMLElement, private readonly options: {
        buffer?: number;
        onRowHeight?: (row: HTMLElement, height: number) => void;
    } = {}) {
        const view = blockElement.ownerDocument.defaultView;
        this.observer = new view.MutationObserver(records => {
            // 内容变化先恢复完整行，缩短文本也能使原有的最小高度失效。
            this.invalidateRecords(records);
            this.schedule();
        });
        this.fontSet = blockElement.ownerDocument.fonts;
        this.fontSet?.addEventListener("loading", this.onFontsChanged);
        this.fontSet?.addEventListener("loadingdone", this.onFontsChanged);
        this.fontSet?.addEventListener("loadingerror", this.onFontsChanged);
        this.observe();
    }

    private readonly onFontsChanged = () => {
        this.invalidate();
        this.schedule();
    };

    private schedule() {
        if (this.frame || this.disposed) {
            return;
        }
        this.frame = this.blockElement.ownerDocument.defaultView.requestAnimationFrame(() => {
            this.frame = 0;
            this.update();
        });
    }

    private observe() {
        if (this.disposed) {
            return;
        }
        const options: MutationObserverInit = {childList: true, subtree: true, characterData: true,
            attributes: true, attributeFilter: ["data-wrap", "data-render-template", "style", "class"]};
        this.observer.observe(this.blockElement, options);
        // 已卸载的单元格仍可能由异步渲染器持有并更新。
        this.rows.forEach(row => row.cells.forEach(cell => {
            if (!row.mounted.has(cell)) {
                this.observer.observe(cell, options);
            }
        }));
    }

    private isCurrent(row: IAVColumnRow) {
        return row.element.firstElementChild === row.prefix && row.element.lastElementChild === row.suffix &&
            Array.from(row.mounted).every(cell => cell.parentElement === row.element) &&
            Array.from(row.element.children).every(child => child === row.prefix || child === row.suffix ||
                row.mounted.has(child as HTMLElement) || row.spacers.includes(child as HTMLElement));
    }

    private invalidateRecords(records: MutationRecord[]) {
        if (records.some(record => record.type === "attributes" && record.target === this.blockElement)) {
            this.invalidate();
            return;
        }
        const changed = new Set<IAVColumnRow>();
        records.forEach(record => {
            let target = record.target.nodeType === Node.ELEMENT_NODE ? record.target as HTMLElement :
                record.target.parentElement;
            while (target && target !== this.blockElement) {
                const row = this.rows.get(target) || this.cellRows.get(target);
                if (row) {
                    changed.add(row);
                    break;
                }
                target = target.parentElement;
            }
        });
        this.observer.disconnect();
        changed.forEach(row => {
            if (this.rows.get(row.element) === row) {
                this.restoreRow(row);
                this.rows.delete(row.element);
            }
        });
        this.observe();
    }

    private restoreRow(row: IAVColumnRow) {
        const current = this.isCurrent(row);
        row.spacers.forEach(spacer => spacer.remove());
        row.spacers = [];
        // 完整行被外部替换时，不能把旧单元格写回新内容。
        if (current) {
            let next: HTMLElement = row.suffix;
            for (let index = row.cells.length - 1; index >= 0; index--) {
                const cell = row.cells[index];
                if (cell.nextElementSibling !== next) {
                    row.element.insertBefore(cell, next);
                }
                next = cell;
            }
            row.mounted = new Set(row.cells);
        }
        if (row.minHeight) {
            row.element.style.setProperty("min-height", row.minHeight, row.minHeightPriority);
        } else {
            row.element.style.removeProperty("min-height");
        }
    }

    restore() {
        this.observer.disconnect();
        this.rows.forEach(row => this.restoreRow(row));
        this.rows.clear();
        this.observe();
    }

    invalidate() {
        this.restore();
    }

    setSuspended(suspended: boolean) {
        this.suspended = suspended;
        if (suspended) {
            this.restore();
        } else {
            this.schedule();
        }
    }

    ensureColumn(columnID: string, rowID?: string, groupID?: string) {
        this.observer.disconnect();
        this.rows.forEach(row => {
            if ((!rowID || row.element.dataset.id === rowID) &&
                (groupID === undefined || row.element.closest<HTMLElement>(".av__body")?.dataset.groupId === groupID) &&
                row.cells.some(cell => cell.dataset.colId === columnID)) {
                // 定位和键盘导航需要相邻列，恢复该行后由后续窗口更新重新裁剪。
                this.restoreRow(row);
                this.rows.delete(row.element);
            }
        });
        this.observe();
    }

    private getBody(body: HTMLElement, scrollElement: HTMLElement): IAVColumnBody | undefined {
        const header = body.querySelector<HTMLElement>(".av__row--header");
        const prefix = header?.firstElementChild as HTMLElement;
        if (!header || !prefix?.classList.contains("av__colsticky")) {
            return;
        }
        if (!hasRowGeometry(header)) {
            return;
        }
        const cells = Array.from(header.children).filter(child => child.classList.contains("av__cell")) as HTMLElement[];
        if (cells.some(cell => !hasColumnGeometry(cell))) {
            return;
        }
        const columns = cells.map(cell => ({id: cell.dataset.colId, width: getBoxSize(cell, "width")}));
        if (columns.length < 2) {
            return;
        }
        const headerRect = header.getBoundingClientRect();
        const scale = headerRect.width / getBoxSize(header, "width");
        const leadingWidth = getBoxSize(prefix, "width");
        if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(leadingWidth) || leadingWidth < 0) {
            return;
        }
        const scrollRect = scrollElement.getBoundingClientRect();
        const window = getAVColumnWindow({columns, leadingWidth,
            viewportLeft: (scrollRect.left - headerRect.left) / scale + scrollElement.clientLeft,
            viewportWidth: scrollElement.clientWidth,
            occludedWidth: body.classList.contains("av__body--unfreeze") ? 0 : leadingWidth,
            buffer: this.options.buffer});
        if (!window) {
            return;
        }
        return {columns, columnIDs: window.columnIDs,
            signature: `${leadingWidth}|${columns.map(column => `${column.id}:${column.width}`).join("|")}`};
    }

    private createRow(element: HTMLElement, body: IAVColumnBody): IAVColumnRow | undefined {
        const children = Array.from(element.children) as HTMLElement[];
        const prefix = children[0];
        const suffix = children[children.length - 1];
        const cells = children.slice(1, -1);
        const style = element.ownerDocument.defaultView.getComputedStyle(element);
        if (!prefix?.classList.contains("av__colsticky") || suffix?.className || suffix?.childElementCount ||
            suffix?.textContent || cells.length !== body.columns.length || !hasRowGeometry(element) ||
            cells.some((cell, index) => !hasColumnGeometry(cell) || cell.dataset.colId !== body.columns[index].id ||
                Math.abs(getBoxSize(cell, "width") - body.columns[index].width) > 0.5)) {
            return;
        }
        // 媒体和异步渲染器依赖尺寸及祖先上下文，保持整行挂载以保留自然高度和渲染权限。
        if (element.querySelector("img, picture, video, audio, iframe, object, embed, canvas, svg image, " +
            'input, textarea, select, [data-render-template]:not([data-render-template=""]), .av__celltext--template, [data-subtype=math], ' +
            "[data-type~=inline-math], .hljs, pre, .code-block")) {
            return;
        }
        const height = element.getBoundingClientRect().height;
        const minimum = parseFloat(style.height);
        if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(minimum) || minimum <= 0) {
            return;
        }
        this.options.onRowHeight?.(element, height);
        return {element, cells, prefix, suffix, mounted: new Set(cells), spacers: [],
            minHeight: element.style.getPropertyValue("min-height"),
            minHeightPriority: element.style.getPropertyPriority("min-height"), minimum,
            signature: body.signature};
    }

    private applyRow(row: IAVColumnRow, body: IAVColumnBody) {
        const wanted = new Set(row.cells.filter(cell => body.columnIDs.has(cell.dataset.colId)));
        if (wanted.size === row.mounted.size && Array.from(wanted).every(cell => row.mounted.has(cell))) {
            return;
        }
        row.element.style.setProperty("min-height", `${row.minimum}px`, row.minHeightPriority);
        const nodes: HTMLElement[] = [];
        let gap = 0;
        let spacerIndex = 0;
        const flush = () => {
            if (!gap) {
                return;
            }
            let spacer = row.spacers[spacerIndex];
            if (!spacer) {
                spacer = row.element.ownerDocument.createElement("div");
                spacer.className = "av__column-spacer";
                spacer.setAttribute("aria-hidden", "true");
            }
            // 占位不使用单元格类，避免被编辑、填充和选择操作当作数据。
            spacer.style.width = `${gap}px`;
            spacer.style.minWidth = `${gap}px`;
            spacer.style.flexBasis = `${gap}px`;
            row.spacers[spacerIndex++] = spacer;
            nodes.push(spacer);
            gap = 0;
        };
        row.cells.forEach((cell, index) => {
            if (wanted.has(cell)) {
                flush();
                nodes.push(cell);
            } else {
                gap += body.columns[index].width;
                if (cell.parentElement === row.element) {
                    cell.remove();
                }
            }
        });
        flush();
        row.spacers.slice(spacerIndex).forEach(spacer => spacer.remove());
        row.spacers.length = spacerIndex;
        let next = row.suffix;
        for (let index = nodes.length - 1; index >= 0; index--) {
            const node = nodes[index];
            if (node.nextElementSibling !== next) {
                row.element.insertBefore(node, next);
            }
            next = node;
        }
        row.mounted = wanted;
    }

    update() {
        if (this.disposed) {
            return;
        }
        const records = this.observer.takeRecords();
        if (records.length) {
            this.invalidateRecords(records);
        }
        this.observer.disconnect();
        try {
            const scrollElement = this.blockElement.querySelector<HTMLElement>(".av__scroll");
            if (this.suspended || !this.blockElement.isConnected || this.blockElement.dataset.avType !== "table" ||
                !scrollElement?.clientWidth || this.fontSet?.status === "loading") {
                this.rows.forEach(row => this.restoreRow(row));
                this.rows.clear();
                return;
            }
            this.rows.forEach((row, element) => {
                if (!this.blockElement.contains(element)) {
                    this.restoreRow(row);
                    this.rows.delete(element);
                }
            });
            const updates: Array<{row: IAVColumnRow; body: IAVColumnBody}> = [];
            this.blockElement.querySelectorAll<HTMLElement>(".av__body").forEach(bodyElement => {
                const body = this.getBody(bodyElement, scrollElement);
                bodyElement.querySelectorAll<HTMLElement>(".av__row[data-id]").forEach(element => {
                    let row = this.rows.get(element);
                    if (row && (!this.isCurrent(row) || row.signature !== body?.signature)) {
                        this.restoreRow(row);
                        this.rows.delete(element);
                        row = undefined;
                    }
                    if (!body || body.columnIDs.size === body.columns.length || hasProtectedContent(element)) {
                        if (row) {
                            this.restoreRow(row);
                            this.rows.delete(element);
                        }
                        return;
                    }
                    if (!row) {
                        row = this.createRow(element, body);
                        if (!row) {
                            return;
                        }
                        this.rows.set(element, row);
                        row.cells.forEach(cell => this.cellRows.set(cell, row));
                    }
                    updates.push({row, body});
                });
            });
            // 完整行的尺寸读取集中在卸载之前，避免逐行交替读取和修改导致重复布局。
            updates.forEach(({row, body}) => this.applyRow(row, body));
        } finally {
            this.observe();
        }
    }

    dispose() {
        this.disposed = true;
        if (this.frame) {
            this.blockElement.ownerDocument.defaultView.cancelAnimationFrame(this.frame);
        }
        this.fontSet?.removeEventListener("loading", this.onFontsChanged);
        this.fontSet?.removeEventListener("loadingdone", this.onFontsChanged);
        this.fontSet?.removeEventListener("loadingerror", this.onFontsChanged);
        this.restore();
    }
}
