import {MenuItem} from "../../menus/Menu";
import {removeBlock} from "../wysiwyg/remove";
import {updateTransaction} from "../wysiwyg/transaction";
import {encodeBase64, isMac} from "./compatibility";
import {removeZWJ} from "./normalizeText";
import {focusByRange, getEditorRange} from "./selection";
import {
    buildTableGrid,
    getTableRangeHTML,
    ITableCellInfo,
    ITableGrid,
} from "./table";

type TableSelectionMode = "row" | "column" | "cell";

interface ITableSelection {
    node: HTMLElement;
    table: HTMLTableElement;
    mode: TableSelectionMode;
    indexes: Set<number>;
    cells: Set<HTMLTableCellElement>;
    anchor: number | HTMLTableCellElement;
    activeCell: HTMLTableCellElement;
}

interface IDragState {
    mode: "row" | "column";
    startX: number;
    startY: number;
    target: number;
    dragging: boolean;
    cellInfos: Map<HTMLTableCellElement, ITableCellInfo>;
}

interface ITableControlRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

const getCell = (target: EventTarget) => {
    return (target as Element)?.closest?.("th, td") as HTMLTableCellElement;
};

const getTableNode = (cell: HTMLTableCellElement) => {
    return cell?.closest<HTMLElement>('[data-type="NodeTable"]');
};

const isPrimaryModifier = (event: MouseEvent | KeyboardEvent) => isMac() ? event.metaKey : event.ctrlKey;

const getRangeIndexes = (start: number, end: number) => {
    const indexes: number[] = [];
    for (let index = Math.min(start, end); index <= Math.max(start, end); index++) {
        indexes.push(index);
    }
    return indexes;
};

const getIndexGroups = (indexes: Set<number>) => {
    const sorted = Array.from(indexes).sort((a, b) => a - b);
    const groups: {start: number; end: number}[] = [];
    sorted.forEach(index => {
        const group = groups[groups.length - 1];
        if (group && group.end + 1 === index) {
            group.end = index;
        } else {
            groups.push({start: index, end: index});
        }
    });
    return groups;
};

const intersectRects = (...rects: ITableControlRect[]) => {
    const left = Math.max(...rects.map(rect => rect.left));
    const top = Math.max(...rects.map(rect => rect.top));
    const right = Math.min(...rects.map(rect => rect.right));
    const bottom = Math.min(...rects.map(rect => rect.bottom));
    return {
        left,
        top,
        right,
        bottom,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
    };
};

const replaceCellTag = (cell: HTMLTableCellElement, tag: "th" | "td") => {
    if (cell.tagName.toLowerCase() === tag) {
        return cell;
    }
    const newCell = document.createElement(tag);
    Array.from(cell.attributes).forEach(attribute => {
        newCell.setAttribute(attribute.name, attribute.value);
    });
    while (cell.firstChild) {
        newCell.append(cell.firstChild);
    }
    cell.replaceWith(newCell);
    return newCell;
};

const getCellText = (cell: HTMLTableCellElement) => cell.innerText.replace(/\n+$/g, "");

export class TableControl {
    private protyle: IProtyle;
    private wysiwygElement: HTMLElement;
    private element: HTMLElement;
    private rowHandle: HTMLButtonElement;
    private columnHandle: HTMLButtonElement;
    private cellHandle: HTMLButtonElement;
    private addRowButton: HTMLButtonElement;
    private addColumnButton: HTMLButtonElement;
    private dropIndicator: HTMLElement;
    private selection: ITableSelection;
    private hoverCell: HTMLTableCellElement;
    private selectionElements: HTMLElement[] = [];
    private selectionElementIndex = 0;
    private selectedCells: HTMLTableCellElement[] = [];
    private selectionGrid: ITableGrid;
    private frame: number;
    private dragState: IDragState;
    private observer: MutationObserver;
    private abortController = new AbortController();

    constructor(protyle: IProtyle, wysiwygElement: HTMLElement) {
        this.protyle = protyle;
        this.wysiwygElement = wysiwygElement;
        this.element = document.createElement("div");
        this.element.className = "protyle-table-control";
        this.element.setAttribute("contenteditable", "false");
        this.element.innerHTML = `<button class="protyle-table-control__handle protyle-table-control__handle--row fn__none" data-type="row" aria-label="${window.siyuan.languages.row}">
    <svg><use xlink:href="#iconDrag"></use></svg>
</button>
<button class="protyle-table-control__handle protyle-table-control__handle--column fn__none" data-type="column" aria-label="${window.siyuan.languages.column}">
    <svg><use xlink:href="#iconDrag"></use></svg>
</button>
<button class="protyle-table-control__handle protyle-table-control__handle--cell fn__none" data-type="cell" aria-label="${window.siyuan.languages.more}">
    <svg><use xlink:href="#iconMore"></use></svg>
</button>
<button class="protyle-table-control__add protyle-table-control__add--row fn__none" data-type="add-row" aria-label="${window.siyuan.languages.insertRowBelow}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</button>
<button class="protyle-table-control__add protyle-table-control__add--column fn__none" data-type="add-column" aria-label="${window.siyuan.languages.insertColumnRight}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</button>
<div class="protyle-table-control__drop fn__none"></div>`;
        this.rowHandle = this.element.querySelector('[data-type="row"]');
        this.columnHandle = this.element.querySelector('[data-type="column"]');
        this.cellHandle = this.element.querySelector('[data-type="cell"]');
        this.addRowButton = this.element.querySelector('[data-type="add-row"]');
        this.addColumnButton = this.element.querySelector('[data-type="add-column"]');
        this.dropIndicator = this.element.querySelector(".protyle-table-control__drop");
        protyle.element.append(this.element);
        this.bindEvents();
        this.observer = new MutationObserver(() => {
            if (this.selection && !this.selection.node.isConnected) {
                this.clear();
            } else if (this.hoverCell && !this.hoverCell.isConnected) {
                this.hoverCell = undefined;
                this.scheduleRender();
            }
        });
        this.observer.observe(this.wysiwygElement, {childList: true, subtree: true});
    }

    public destroy() {
        this.abortController.abort();
        this.observer.disconnect();
        cancelAnimationFrame(this.frame);
        this.element.remove();
    }

    public clear() {
        this.selection = undefined;
        this.selectionGrid = undefined;
        this.selectedCells = [];
        this.selectionElements.forEach(item => item.remove());
        this.selectionElements = [];
        this.selectionElementIndex = 0;
        this.dropIndicator.classList.add("fn__none");
        this.scheduleRender();
    }

    private bindEvents() {
        const signal = this.abortController.signal;
        this.wysiwygElement.addEventListener("pointermove", event => {
            const cell = getCell(event.target);
            if (cell && getTableNode(cell) && !this.protyle.disabled) {
                if (cell === this.hoverCell) {
                    return;
                }
                this.hoverCell = cell;
                this.scheduleRender();
            } else if (this.hoverCell) {
                this.hoverCell = undefined;
                this.scheduleRender();
            }
        }, {signal});
        this.wysiwygElement.addEventListener("pointerleave", event => {
            if (this.element.contains(event.relatedTarget as Node)) {
                return;
            }
            this.hoverCell = undefined;
            this.scheduleRender();
        }, {signal});
        this.wysiwygElement.addEventListener("pointerdown", event => {
            if (event.button === 0 && !(event.ctrlKey && isMac()) &&
                !(event.target as Element).closest(".protyle-table-control")) {
                this.clear();
            }
        }, {capture: true, signal});
        this.wysiwygElement.addEventListener("contextmenu", event => {
            if (!this.selection) {
                return;
            }
            const cell = getCell(event.target);
            if (!cell || getTableNode(cell) !== this.selection.node) {
                this.clear();
                return;
            }
            if (!this.isCellInSelection(cell)) {
                this.selectFromCell(this.selection.mode, cell, false, false);
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.openMenu(event.clientX, event.clientY);
        }, {capture: true, signal});
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && this.selection) {
                this.clear();
            }
        }, {signal});
        document.addEventListener("pointerdown", event => {
            if (!this.selection) {
                return;
            }
            const target = event.target as Node;
            if (this.element.contains(target) || this.selection.node.contains(target) ||
                document.getElementById("commonMenu")?.contains(target)) {
                return;
            }
            this.clear();
        }, {capture: true, signal});
        document.addEventListener("copy", event => {
            if (!this.selection) {
                return;
            }
            this.writeClipboard(event);
            event.preventDefault();
            event.stopImmediatePropagation();
        }, {capture: true, signal});
        document.addEventListener("cut", event => {
            if (!this.selection) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            if (this.protyle.disabled || !this.canMutateSelection()) {
                return;
            }
            if (this.writeClipboard(event)) {
                this.deleteSelection(true);
            }
        }, {capture: true, signal});
        this.protyle.element.addEventListener("scroll", () => this.scheduleRender(), {capture: true, signal});
        window.addEventListener("resize", () => this.scheduleRender(), {signal});
        this.element.addEventListener("pointerdown", event => this.handlePointerDown(event), {signal});
        this.element.addEventListener("click", event => this.handleClick(event), {signal});
        this.element.addEventListener("contextmenu", event => {
            const type = (event.target as Element).closest<HTMLElement>("[data-type]")?.dataset.type;
            if (!this.hoverCell || (type !== "row" && type !== "column" && type !== "cell")) {
                return;
            }
            if (!this.selection || this.selection.mode !== type || !this.isCellInSelection(this.hoverCell)) {
                this.selectFromCell(type, this.hoverCell, false, false);
            }
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event.clientX, event.clientY);
        }, {signal});
        this.element.addEventListener("pointerleave", event => {
            if (this.wysiwygElement.contains(event.relatedTarget as Node)) {
                return;
            }
            this.hoverCell = undefined;
            this.scheduleRender();
        }, {signal});
    }

    private handlePointerDown(event: PointerEvent) {
        const type = (event.target as Element).closest<HTMLElement>("[data-type]")?.dataset.type;
        if (!type || !this.hoverCell) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (type !== "row" && type !== "column") {
            return;
        }
        this.selectFromCell(type, this.hoverCell, isPrimaryModifier(event), event.shiftKey);
        if (!this.selection) {
            return;
        }
        const grid = buildTableGrid(this.selection.table);
        if (grid.cellInfos.some(info => info.rowspan > 1 || info.colspan > 1) ||
            (type === "row" && this.selection.indexes.size > 1 && this.selection.indexes.has(0))) {
            return;
        }
        this.dragState = {
            mode: type,
            startX: event.clientX,
            startY: event.clientY,
            target: -1,
            dragging: false,
            cellInfos: new Map(grid.cellInfos.map(info => [info.cell, info])),
        };
        const move = (moveEvent: PointerEvent) => this.handleDragMove(moveEvent);
        const up = (upEvent: PointerEvent) => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            this.handleDragEnd(upEvent);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
    }

    private handleClick(event: MouseEvent) {
        const type = (event.target as Element).closest<HTMLElement>("[data-type]")?.dataset.type;
        if (!type || !this.hoverCell) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (type === "add-row" || type === "add-column") {
            this.addAtEnd(type);
            return;
        }
        if (type !== "row" && type !== "column" && type !== "cell") {
            return;
        }
        if (type === "row" || type === "column") {
            if (this.dragState?.dragging) {
                this.dragState = undefined;
                return;
            }
            if (!isPrimaryModifier(event) && !event.shiftKey) {
                const handle = type === "row" ? this.rowHandle : this.columnHandle;
                const rect = handle.getBoundingClientRect();
                this.openMenu(rect.right, rect.bottom);
            }
            return;
        }
        this.selectFromCell(type, this.hoverCell, isPrimaryModifier(event), event.shiftKey);
        if (!isPrimaryModifier(event) && !event.shiftKey) {
            const rect = this.cellHandle.getBoundingClientRect();
            this.openMenu(rect.right, rect.bottom);
        }
    }

    private selectFromCell(mode: TableSelectionMode, cell: HTMLTableCellElement, toggle: boolean, extend: boolean) {
        const node = getTableNode(cell);
        const table = cell.closest("table") as HTMLTableElement;
        if (!node || !table) {
            return;
        }
        node.querySelector(".table__select")?.removeAttribute("style");
        this.wysiwygElement.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
            item.classList.remove("protyle-wysiwyg--select");
        });
        const grid = buildTableGrid(table);
        const info = grid.cellInfos.find(item => item.cell === cell);
        if (!info) {
            return;
        }
        const sameSelection = this.selection?.node === node && this.selection.mode === mode;
        if (!sameSelection) {
            this.selection = {
                node,
                table,
                mode,
                indexes: new Set(),
                cells: new Set(),
                anchor: mode === "cell" ? cell : mode === "row" ? info.row : info.col,
                activeCell: cell,
            };
        }
        this.selection.activeCell = cell;
        if (mode === "cell") {
            if (extend && this.selection.anchor instanceof HTMLTableCellElement) {
                const anchorInfo = grid.cellInfos.find(item => item.cell === this.selection.anchor);
                const selected = this.getCellsInRectangle(grid.cellInfos, anchorInfo, info);
                if (!toggle) {
                    this.selection.cells.clear();
                }
                selected.forEach(item => this.selection.cells.add(item));
            } else if (toggle) {
                if (this.selection.cells.has(cell)) {
                    this.selection.cells.delete(cell);
                } else {
                    this.selection.cells.add(cell);
                }
                this.selection.anchor = cell;
            } else {
                this.selection.cells = new Set([cell]);
                this.selection.anchor = cell;
            }
        } else {
            const index = mode === "row" ? info.row : info.col;
            if (extend && typeof this.selection.anchor === "number") {
                if (!toggle) {
                    this.selection.indexes.clear();
                }
                getRangeIndexes(this.selection.anchor, index).forEach(item => this.selection.indexes.add(item));
            } else if (toggle) {
                const toggleIndexes = this.getMergedIndexClosure(grid.cellInfos, index);
                if (this.selection.indexes.has(index)) {
                    toggleIndexes.forEach(item => this.selection.indexes.delete(item));
                } else {
                    toggleIndexes.forEach(item => this.selection.indexes.add(item));
                }
                this.selection.anchor = index;
            } else {
                this.selection.indexes = new Set([index]);
                this.selection.anchor = index;
            }
            this.expandMergedIndexes(grid.cellInfos);
        }
        if (this.selection.indexes.size === 0 && this.selection.cells.size === 0) {
            this.clear();
            return;
        }
        this.updateSelectedCells(grid);
        getSelection()?.removeAllRanges();
        this.scheduleRender();
    }

    private expandMergedIndexes(cellInfos: ITableCellInfo[]) {
        if (!this.selection || this.selection.mode === "cell") {
            return;
        }
        let changed = true;
        while (changed) {
            changed = false;
            cellInfos.forEach(info => {
                const start = this.selection.mode === "row" ? info.row : info.col;
                const span = this.selection.mode === "row" ? info.rowspan : info.colspan;
                const indexes = getRangeIndexes(start, start + span - 1);
                if (indexes.some(index => this.selection.indexes.has(index))) {
                    indexes.forEach(index => {
                        if (!this.selection.indexes.has(index)) {
                            this.selection.indexes.add(index);
                            changed = true;
                        }
                    });
                }
            });
        }
    }

    private getMergedIndexClosure(cellInfos: ITableCellInfo[], index: number) {
        const indexes = new Set([index]);
        let changed = true;
        while (changed) {
            changed = false;
            cellInfos.forEach(info => {
                const start = this.selection.mode === "row" ? info.row : info.col;
                const span = this.selection.mode === "row" ? info.rowspan : info.colspan;
                const spanIndexes = getRangeIndexes(start, start + span - 1);
                if (spanIndexes.some(item => indexes.has(item))) {
                    spanIndexes.forEach(item => {
                        if (!indexes.has(item)) {
                            indexes.add(item);
                            changed = true;
                        }
                    });
                }
            });
        }
        return indexes;
    }

    private getCellsInRectangle(cellInfos: ITableCellInfo[], start: ITableCellInfo, end: ITableCellInfo) {
        if (!start || !end) {
            return [];
        }
        let rowStart = Math.min(start.row, end.row);
        let rowEnd = Math.max(start.row + start.rowspan - 1, end.row + end.rowspan - 1);
        let colStart = Math.min(start.col, end.col);
        let colEnd = Math.max(start.col + start.colspan - 1, end.col + end.colspan - 1);
        let changed = true;
        while (changed) {
            changed = false;
            cellInfos.forEach(info => {
                if (info.row <= rowEnd && info.row + info.rowspan - 1 >= rowStart &&
                    info.col <= colEnd && info.col + info.colspan - 1 >= colStart) {
                    const nextRowStart = Math.min(rowStart, info.row);
                    const nextRowEnd = Math.max(rowEnd, info.row + info.rowspan - 1);
                    const nextColStart = Math.min(colStart, info.col);
                    const nextColEnd = Math.max(colEnd, info.col + info.colspan - 1);
                    changed = nextRowStart !== rowStart || nextRowEnd !== rowEnd ||
                        nextColStart !== colStart || nextColEnd !== colEnd;
                    rowStart = nextRowStart;
                    rowEnd = nextRowEnd;
                    colStart = nextColStart;
                    colEnd = nextColEnd;
                }
            });
        }
        return cellInfos.filter(info => info.row <= rowEnd && info.row + info.rowspan - 1 >= rowStart &&
            info.col <= colEnd && info.col + info.colspan - 1 >= colStart).map(info => info.cell);
    }

    private isCellInSelection(cell: HTMLTableCellElement) {
        if (!this.selection) {
            return false;
        }
        const grid = this.selectionGrid || buildTableGrid(this.selection.table);
        const info = grid.cellInfos.find(item => item.cell === cell);
        if (!info) {
            return false;
        }
        if (this.selection.mode === "cell") {
            return this.selection.cells.has(cell);
        }
        const start = this.selection.mode === "row" ? info.row : info.col;
        const span = this.selection.mode === "row" ? info.rowspan : info.colspan;
        return getRangeIndexes(start, start + span - 1).some(index => this.selection.indexes.has(index));
    }

    private getSelectedCells() {
        return this.selectedCells.filter(cell => cell.isConnected);
    }

    private updateSelectedCells(grid?: ITableGrid) {
        if (!this.selection) {
            this.selectedCells = [];
            this.selectionGrid = undefined;
            return;
        }
        grid = grid || buildTableGrid(this.selection.table);
        this.selectionGrid = grid;
        if (this.selection.mode === "cell") {
            this.selectedCells = Array.from(this.selection.cells);
            return;
        }
        this.selectedCells = grid.cellInfos.filter(info => {
            const start = this.selection.mode === "row" ? info.row : info.col;
            const span = this.selection.mode === "row" ? info.rowspan : info.colspan;
            return getRangeIndexes(start, start + span - 1).some(index => this.selection.indexes.has(index));
        }).map(info => info.cell);
    }

    private isRectangle() {
        if (!this.selection || this.selection.mode !== "cell" || this.selection.cells.size === 0) {
            return false;
        }
        const grid = this.selectionGrid || buildTableGrid(this.selection.table);
        const infos = grid.cellInfos.filter(info => this.selection.cells.has(info.cell));
        const rowStart = Math.min(...infos.map(info => info.row));
        const rowEnd = Math.max(...infos.map(info => info.row + info.rowspan - 1));
        const colStart = Math.min(...infos.map(info => info.col));
        const colEnd = Math.max(...infos.map(info => info.col + info.colspan - 1));
        const slots = new Set<string>();
        infos.forEach(info => {
            for (let row = info.row; row < info.row + info.rowspan; row++) {
                for (let col = info.col; col < info.col + info.colspan; col++) {
                    slots.add(`${row}:${col}`);
                }
            }
        });
        return slots.size === (rowEnd - rowStart + 1) * (colEnd - colStart + 1);
    }

    private scheduleRender() {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => this.render());
    }

    private setPosition(element: HTMLElement, left: number, top: number) {
        element.style.left = `${Math.round(left)}px`;
        element.style.top = `${Math.round(top)}px`;
    }

    private getTableViewportRect(table: HTMLTableElement) {
        const tableRect = table.getBoundingClientRect();
        const wrapperRect = table.parentElement.getBoundingClientRect();
        const contentRect = (this.protyle.contentElement || this.protyle.element).getBoundingClientRect();
        return intersectRects(tableRect, wrapperRect, contentRect);
    }

    private appendSelectionRect(rect: ITableControlRect, viewportRect: ITableControlRect) {
        const visibleRect = intersectRects(rect, viewportRect);
        if (visibleRect.width === 0 || visibleRect.height === 0) {
            return;
        }
        let selectionElement = this.selectionElements[this.selectionElementIndex];
        if (!selectionElement) {
            selectionElement = document.createElement("div");
            selectionElement.className = "protyle-table-control__selection";
            this.element.append(selectionElement);
            this.selectionElements.push(selectionElement);
        }
        this.selectionElementIndex++;
        selectionElement.classList.remove("fn__none");
        selectionElement.style.left = `${visibleRect.left}px`;
        selectionElement.style.top = `${visibleRect.top}px`;
        selectionElement.style.width = `${visibleRect.width}px`;
        selectionElement.style.height = `${visibleRect.height}px`;
    }

    private render() {
        const cell = this.hoverCell?.isConnected ? this.hoverCell : this.selection?.activeCell;
        const node = getTableNode(cell);
        const table = cell?.closest("table") as HTMLTableElement;
        const visible = !!cell && !!node && !!table && !this.protyle.disabled;
        [this.rowHandle, this.columnHandle, this.cellHandle, this.addRowButton, this.addColumnButton].forEach(item => {
            item.classList.add("fn__none");
        });
        if (visible) {
            const cellRect = cell.getBoundingClientRect();
            const rowRect = cell.parentElement.getBoundingClientRect();
            const tableRect = table.getBoundingClientRect();
            const viewportRect = this.getTableViewportRect(table);
            const visibleCellRect = intersectRects(cellRect, viewportRect);
            const visibleRowRect = intersectRects(rowRect, viewportRect);
            if (visibleRowRect.width > 0 && visibleRowRect.height > 0) {
                this.rowHandle.classList.remove("fn__none");
                this.setPosition(this.rowHandle, viewportRect.left - 11,
                    visibleRowRect.top + visibleRowRect.height / 2);
            }
            if (visibleCellRect.width > 0 && viewportRect.height > 0) {
                this.columnHandle.classList.remove("fn__none");
                this.setPosition(this.columnHandle, visibleCellRect.left + visibleCellRect.width / 2,
                    viewportRect.top - 11);
            }
            if (visibleCellRect.width > 0 && visibleCellRect.height > 0) {
                this.cellHandle.classList.remove("fn__none");
                this.setPosition(this.cellHandle, visibleCellRect.right - 5, visibleCellRect.top + 5);
            }
            if (viewportRect.width > 0 && tableRect.bottom <= viewportRect.bottom + 1 &&
                tableRect.bottom >= viewportRect.top) {
                this.addRowButton.classList.remove("fn__none");
                this.setPosition(this.addRowButton, viewportRect.left + viewportRect.width / 2, tableRect.bottom + 7);
            }
            if (viewportRect.height > 0 && tableRect.right <= viewportRect.right + 1 &&
                tableRect.right >= viewportRect.left) {
                this.addColumnButton.classList.remove("fn__none");
                this.setPosition(this.addColumnButton, tableRect.right + 7,
                    viewportRect.top + viewportRect.height / 2);
            }
        }
        this.selectionElementIndex = 0;
        this.selectionElements.forEach(item => item.classList.add("fn__none"));
        if (!this.selection?.node.isConnected) {
            this.selection = undefined;
            this.selectionGrid = undefined;
            this.selectedCells = [];
            return;
        }
        const selectionViewportRect = this.getTableViewportRect(this.selection.table);
        if (this.selection.mode === "row") {
            const rows = Array.from(this.selection.table.rows);
            getIndexGroups(this.selection.indexes).forEach(group => {
                const startRect = rows[group.start]?.getBoundingClientRect();
                const endRect = rows[group.end]?.getBoundingClientRect();
                if (startRect && endRect) {
                    this.appendSelectionRect({
                        left: selectionViewportRect.left,
                        top: startRect.top,
                        right: selectionViewportRect.right,
                        bottom: endRect.bottom,
                        width: selectionViewportRect.width,
                        height: endRect.bottom - startRect.top,
                    }, selectionViewportRect);
                }
            });
        } else if (this.selection.mode === "column") {
            const grid = this.selectionGrid || buildTableGrid(this.selection.table);
            getIndexGroups(this.selection.indexes).forEach(group => {
                const startRect = grid.grid[0]?.[group.start]?.getBoundingClientRect();
                const endRect = grid.grid[0]?.[group.end]?.getBoundingClientRect();
                if (startRect && endRect) {
                    this.appendSelectionRect({
                        left: startRect.left,
                        top: selectionViewportRect.top,
                        right: endRect.right,
                        bottom: selectionViewportRect.bottom,
                        width: endRect.right - startRect.left,
                        height: selectionViewportRect.height,
                    }, selectionViewportRect);
                }
            });
        } else if (this.isRectangle()) {
            const cells = this.getSelectedCells();
            const rects = cells.map(item => item.getBoundingClientRect());
            if (rects.length > 0) {
                const left = Math.min(...rects.map(rect => rect.left));
                const top = Math.min(...rects.map(rect => rect.top));
                const right = Math.max(...rects.map(rect => rect.right));
                const bottom = Math.max(...rects.map(rect => rect.bottom));
                this.appendSelectionRect({left, top, right, bottom, width: right - left, height: bottom - top},
                    selectionViewportRect);
            }
        } else {
            this.getSelectedCells().forEach(item => {
                this.appendSelectionRect(item.getBoundingClientRect(), selectionViewportRect);
            });
        }
    }

    private openMenu(x: number, y: number) {
        if (!this.selection) {
            return;
        }
        const menu = window.siyuan.menus.menu;
        menu.remove();
        const merged = buildTableGrid(this.selection.table).cellInfos.some(info => info.rowspan > 1 || info.colspan > 1);
        const rectangle = this.selection.mode !== "cell" || this.isRectangle();
        menu.append(new MenuItem({
            icon: "iconCopy",
            label: window.siyuan.languages.copy,
            disabled: !rectangle,
            accelerator: rectangle ? undefined : window.siyuan.languages.tableRectangleSelectionRequired,
            click: () => this.execClipboardCommand("copy"),
        }).element);
        menu.append(new MenuItem({
            icon: "iconCut",
            label: window.siyuan.languages.cut,
            disabled: this.protyle.disabled || !rectangle || (this.selection.mode !== "cell" && merged),
            accelerator: !rectangle ? window.siyuan.languages.tableRectangleSelectionRequired :
                this.selection.mode !== "cell" && merged ? window.siyuan.languages.cancelMerged : undefined,
            click: () => this.execClipboardCommand("cut"),
        }).element);
        menu.append(new MenuItem({type: "separator"}).element);
        if (!this.protyle.disabled) {
            this.appendInsertMenus();
            if (this.selection.mode !== "cell") {
                menu.append(new MenuItem({
                    icon: "iconCopy",
                    label: window.siyuan.languages.duplicate,
                    disabled: merged,
                    click: () => this.duplicateRowsOrColumns(),
                }).element);
            }
            menu.append(new MenuItem({
                icon: "iconClear",
                label: window.siyuan.languages.clear,
                click: () => this.clearCells(),
            }).element);
            menu.append(new MenuItem({
                icon: "iconTheme",
                label: window.siyuan.languages.colorPrimary,
                submenu: this.getBackgroundMenus(),
            }).element);
            if (this.selection.mode === "cell") {
                this.appendCellMenus(rectangle);
            } else {
                if (this.selection.mode === "column") {
                    this.appendAlignmentMenus();
                }
                menu.append(new MenuItem({
                    icon: this.selection.mode === "row" ? "iconTrashcan" : "iconTrashcan",
                    label: this.selection.mode === "row" ? window.siyuan.languages["delete-row"] :
                        window.siyuan.languages["delete-column"],
                    disabled: merged,
                    click: () => this.deleteSelection(false),
                }).element);
            }
        }
        menu.popup({x, y});
    }

    private appendInsertMenus() {
        const selection = this.selection;
        const indexes = Array.from(selection.indexes).sort((a, b) => a - b);
        const grid = this.selectionGrid || buildTableGrid(selection.table);
        if (this.selection.mode === "row") {
            const above = indexes[0];
            const below = indexes[indexes.length - 1] + 1;
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAdd",
                label: window.siyuan.languages.insertRowAbove,
                disabled: !this.canInsertAtBoundary(grid, "row", above),
                click: () => {
                    this.insertRowAt(selection.node, selection.table, above);
                },
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAdd",
                label: window.siyuan.languages.insertRowBelow,
                disabled: !this.canInsertAtBoundary(grid, "row", below),
                click: () => {
                    this.insertRowAt(selection.node, selection.table, below);
                },
            }).element);
        } else if (this.selection.mode === "column") {
            const left = indexes[0];
            const right = indexes[indexes.length - 1] + 1;
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAdd",
                label: window.siyuan.languages.insertColumnLeft,
                disabled: !this.canInsertAtBoundary(grid, "column", left),
                click: () => {
                    this.insertColumnAt(selection.node, selection.table, left);
                },
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAdd",
                label: window.siyuan.languages.insertColumnRight,
                disabled: !this.canInsertAtBoundary(grid, "column", right),
                click: () => {
                    this.insertColumnAt(selection.node, selection.table, right);
                },
            }).element);
        }
    }

    private canInsertAtBoundary(grid: ITableGrid, mode: "row" | "column", index: number) {
        return !grid.cellInfos.some(info => {
            const start = mode === "row" ? info.row : info.col;
            const span = mode === "row" ? info.rowspan : info.colspan;
            return start < index && start + span > index;
        });
    }

    private insertRowAt(node: HTMLElement, table: HTMLTableElement, index: number) {
        const grid = buildTableGrid(table);
        if (!this.canInsertAtBoundary(grid, "row", index)) {
            return;
        }
        const oldHTML = node.outerHTML;
        const row = document.createElement("tr");
        const headRowCount = table.tHead?.rows.length || 0;
        const tag = index < headRowCount || index === 0 ? "th" : "td";
        const sourceRow = Math.min(index, Math.max(0, grid.rowCount - 1));
        for (let column = 0; column < grid.columnCount; column++) {
            const cell = document.createElement(tag);
            const align = grid.grid[sourceRow]?.[column]?.getAttribute("align");
            if (align) {
                cell.setAttribute("align", align);
            }
            row.append(cell);
        }
        const reference = table.rows[index];
        if (reference) {
            reference.before(row);
        } else {
            (table.tBodies[0] || table.createTBody()).append(row);
        }
        if (index === 0) {
            this.normalizeTableSections(table);
        }
        if (row.cells[0]) {
            const range = document.createRange();
            range.selectNodeContents(row.cells[0]);
            range.collapse(true);
            focusByRange(range);
        }
        updateTransaction(this.protyle, node, oldHTML);
        this.clear();
    }

    private insertColumnAt(node: HTMLElement, table: HTMLTableElement, index: number) {
        const grid = buildTableGrid(table);
        if (!this.canInsertAtBoundary(grid, "column", index)) {
            return;
        }
        const oldHTML = node.outerHTML;
        let focusCell: HTMLTableCellElement;
        Array.from(table.rows).forEach(row => {
            const cell = document.createElement(row.parentElement.tagName === "THEAD" ? "th" : "td");
            const reference = row.cells[index];
            if (reference) {
                reference.before(cell);
            } else {
                row.append(cell);
            }
            if (!focusCell) {
                focusCell = cell;
            }
        });
        const colgroup = table.querySelector(":scope > colgroup");
        if (colgroup) {
            const column = document.createElement("col");
            column.style.minWidth = "60px";
            const reference = colgroup.children[index];
            if (reference) {
                reference.before(column);
            } else {
                colgroup.append(column);
            }
        }
        if (focusCell) {
            const range = document.createRange();
            range.selectNodeContents(focusCell);
            range.collapse(true);
            focusByRange(range);
        }
        updateTransaction(this.protyle, node, oldHTML);
        this.clear();
    }

    private execClipboardCommand(command: "copy" | "cut") {
        if (!this.selection?.activeCell.isConnected) {
            return;
        }
        const range = getEditorRange(this.selection.activeCell);
        range.selectNodeContents(this.selection.activeCell);
        range.collapse(true);
        focusByRange(range);
        document.execCommand(command);
    }

    private appendCellMenus(rectangle: boolean) {
        this.appendAlignmentMenus();
        window.siyuan.menus.menu.append(new MenuItem({
            label: `${window.siyuan.languages.alignment} ↑`,
            click: () => this.setCellStyle("vertical-align", "top"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: `${window.siyuan.languages.alignment} ↕`,
            click: () => this.setCellStyle("vertical-align", "middle"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: `${window.siyuan.languages.alignment} ↓`,
            click: () => this.setCellStyle("vertical-align", "bottom"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: `${window.siyuan.languages.useDefaultAlign} ↕`,
            click: () => this.setCellStyle("vertical-align", ""),
        }).element);
        const cells = this.getSelectedCells();
        const mergedCell = cells.length === 1 && (cells[0].rowSpan > 1 || cells[0].colSpan > 1);
        window.siyuan.menus.menu.append(new MenuItem({
            label: mergedCell ? window.siyuan.languages.cancelMerged : window.siyuan.languages.mergeCell,
            disabled: !mergedCell && (!rectangle || cells.length < 2 || !this.isSelectionInOneSection()),
            accelerator: !mergedCell && !rectangle ? window.siyuan.languages.tableRectangleSelectionRequired : undefined,
            click: () => mergedCell ? this.splitCell(cells[0]) : this.mergeCells(),
        }).element);
    }

    private appendAlignmentMenus() {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAlignLeft",
            label: window.siyuan.languages.alignLeft,
            click: () => this.setCellStyle("text-align", "left"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAlignCenter",
            label: window.siyuan.languages.alignCenter,
            click: () => this.setCellStyle("text-align", "center"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAlignRight",
            label: window.siyuan.languages.alignRight,
            click: () => this.setCellStyle("text-align", "right"),
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.useDefaultAlign,
            click: () => this.setCellStyle("text-align", ""),
        }).element);
    }

    private isSelectionInOneSection() {
        const sections = new Set(this.getSelectedCells().map(cell => cell.parentElement.parentElement.tagName));
        return sections.size === 1;
    }

    private getBackgroundMenus(): IMenu[] {
        const colors = ["", ...Array.from({length: 13}, (_, index) => `var(--b3-font-background${index + 1})`)];
        return colors.map((color, index) => ({
            label: index === 0 ? window.siyuan.languages.default : `${window.siyuan.languages.colorPrimary} ${index}`,
            iconHTML: `<span class="protyle-table-control__color" style="${color ? `background-color: ${color}` : ""}"></span>`,
            click: () => this.setCellStyle("background-color", color),
        }));
    }

    private setCellStyle(property: string, value: string) {
        if (!this.selection) {
            return;
        }
        const oldHTML = this.selection.node.outerHTML;
        this.getSelectedCells().forEach(cell => {
            if (value) {
                cell.style.setProperty(property, value);
            } else {
                cell.style.removeProperty(property);
                if (!cell.getAttribute("style")) {
                    cell.removeAttribute("style");
                }
            }
        });
        updateTransaction(this.protyle, this.selection.node, oldHTML);
        this.scheduleRender();
    }

    private clearCells() {
        if (!this.selection) {
            return;
        }
        const oldHTML = this.selection.node.outerHTML;
        this.getSelectedCells().forEach(cell => cell.innerHTML = "");
        updateTransaction(this.protyle, this.selection.node, oldHTML);
        this.scheduleRender();
    }

    private canMutateSelection() {
        if (!this.selection) {
            return false;
        }
        if (this.selection.mode === "cell") {
            return this.isRectangle();
        }
        return !buildTableGrid(this.selection.table).cellInfos.some(info => info.rowspan > 1 || info.colspan > 1);
    }

    private deleteSelection(clearOnly: boolean) {
        if (!this.selection || !this.canMutateSelection()) {
            return;
        }
        if (clearOnly && this.selection.mode === "cell") {
            this.clearCells();
            return;
        }
        if (clearOnly && this.selection.mode !== "cell") {
            this.deleteRowsOrColumns();
            return;
        }
        if (this.selection.mode === "cell") {
            this.clearCells();
        } else {
            this.deleteRowsOrColumns();
        }
    }

    private deleteRowsOrColumns() {
        const selection = this.selection;
        const grid = buildTableGrid(selection.table);
        const total = selection.mode === "row" ? grid.rowCount : grid.columnCount;
        if (selection.indexes.size >= total) {
            const range = getEditorRange(selection.node);
            selection.node.classList.add("protyle-wysiwyg--select");
            removeBlock(this.protyle, selection.node, range, "remove");
            this.clear();
            return;
        }
        const oldHTML = selection.node.outerHTML;
        const indexes = Array.from(selection.indexes).sort((a, b) => b - a);
        if (selection.mode === "row") {
            const rows = Array.from(selection.table.rows);
            indexes.forEach(index => rows[index]?.remove());
            this.normalizeTableSections(selection.table);
        } else {
            Array.from(selection.table.rows).forEach(row => {
                indexes.forEach(index => row.cells[index]?.remove());
            });
            const columns = Array.from(selection.table.querySelectorAll("col"));
            indexes.forEach(index => columns[index]?.remove());
        }
        updateTransaction(this.protyle, selection.node, oldHTML);
        this.clear();
    }

    private duplicateRowsOrColumns() {
        if (!this.selection || this.selection.mode === "cell" || !this.canMutateSelection()) {
            return;
        }
        const selection = this.selection;
        const selected = Array.from(selection.indexes).sort((a, b) => a - b);
        const oldHTML = selection.node.outerHTML;
        if (selection.mode === "row") {
            const rows = Array.from(selection.table.rows);
            const clones = selected.map(index => rows[index]?.cloneNode(true) as HTMLTableRowElement).filter(Boolean);
            clones.forEach(row => Array.from(row.cells).forEach(cell => replaceCellTag(cell, "td")));
            const lastIndex = selected[selected.length - 1];
            if (lastIndex === 0) {
                const body = selection.table.tBodies[0] || selection.table.createTBody();
                clones.slice().reverse().forEach(row => {
                    body.insertAdjacentElement("afterbegin", row);
                });
                selection.indexes = new Set(getRangeIndexes(1, clones.length));
            } else {
                let lastRow = rows[lastIndex];
                clones.forEach(row => {
                    lastRow.insertAdjacentElement("afterend", row);
                    lastRow = row;
                });
                selection.indexes = new Set(getRangeIndexes(lastIndex + 1, lastIndex + clones.length));
            }
        } else {
            Array.from(selection.table.rows).forEach(row => {
                const cells = Array.from(row.cells);
                let lastCell = cells[selected[selected.length - 1]];
                selected.map(index => cells[index]?.cloneNode(true) as HTMLTableCellElement).filter(Boolean)
                    .forEach(cell => {
                        lastCell.insertAdjacentElement("afterend", cell);
                        lastCell = cell;
                    });
            });
            const columns = Array.from(selection.table.querySelectorAll("col"));
            if (columns.length > 0) {
                let lastColumn = columns[selected[selected.length - 1]];
                selected.map(index => columns[index]?.cloneNode(true) as HTMLTableColElement).filter(Boolean)
                    .forEach(column => {
                        lastColumn.insertAdjacentElement("afterend", column);
                        lastColumn = column;
                    });
            }
            const start = selected[selected.length - 1] + 1;
            selection.indexes = new Set(getRangeIndexes(start, start + selected.length - 1));
        }
        updateTransaction(this.protyle, selection.node, oldHTML);
        this.updateSelectedCells();
        const activeCell = this.selectedCells[0];
        if (activeCell) {
            selection.activeCell = activeCell;
            this.hoverCell = activeCell;
        }
        this.scheduleRender();
    }

    private normalizeTableSections(table: HTMLTableElement) {
        const rows = Array.from(table.rows);
        let head = table.tHead;
        let body = table.tBodies[0];
        if (!head) {
            head = table.createTHead();
        }
        if (!body) {
            body = table.createTBody();
        }
        head.innerHTML = "";
        body.innerHTML = "";
        rows.forEach((row, index) => {
            Array.from(row.cells).forEach(cell => replaceCellTag(cell, index === 0 ? "th" : "td"));
            (index === 0 ? head : body).append(row);
        });
        Array.from(table.tBodies).slice(1).forEach(item => item.remove());
    }

    private mergeCells() {
        if (!this.selection || !this.isRectangle()) {
            return;
        }
        const grid = buildTableGrid(this.selection.table);
        const infos = grid.cellInfos.filter(info => this.selection.cells.has(info.cell))
            .sort((a, b) => a.row - b.row || a.col - b.col);
        if (infos.length < 2) {
            return;
        }
        const rowStart = Math.min(...infos.map(info => info.row));
        const rowEnd = Math.max(...infos.map(info => info.row + info.rowspan - 1));
        const colStart = Math.min(...infos.map(info => info.col));
        const colEnd = Math.max(...infos.map(info => info.col + info.colspan - 1));
        const oldHTML = this.selection.node.outerHTML;
        const first = infos[0].cell;
        const contents = infos.map(info => info.cell.innerHTML.trim().replace(/<br>$/, "")).filter(Boolean);
        infos.slice(1).forEach(info => {
            info.cell.innerHTML = "";
            info.cell.classList.add("fn__none");
        });
        first.innerHTML = contents.join("<br>");
        first.rowSpan = rowEnd - rowStart + 1;
        first.colSpan = colEnd - colStart + 1;
        updateTransaction(this.protyle, this.selection.node, oldHTML);
        this.selection.cells = new Set([first]);
        this.selection.activeCell = first;
        this.hoverCell = first;
        this.updateSelectedCells();
        this.scheduleRender();
    }

    private splitCell(cell: HTMLTableCellElement) {
        if (!this.selection) {
            return;
        }
        const grid = buildTableGrid(this.selection.table);
        const info = grid.cellInfos.find(item => item.cell === cell);
        if (!info) {
            return;
        }
        const oldHTML = this.selection.node.outerHTML;
        const rows = Array.from(this.selection.table.rows);
        for (let row = info.row; row < info.row + info.rowspan; row++) {
            for (let col = info.col; col < info.col + info.colspan; col++) {
                const current = rows[row]?.cells[col];
                if (current && current !== cell) {
                    current.classList.remove("fn__none");
                    current.removeAttribute("rowspan");
                    current.removeAttribute("colspan");
                }
            }
        }
        cell.removeAttribute("rowspan");
        cell.removeAttribute("colspan");
        if (cell.tagName === "TH") {
            const head = this.selection.table.tHead;
            const body = this.selection.table.tBodies[0] || this.selection.table.createTBody();
            const pureRow = Array.from(head?.rows || []).find(row =>
                Array.from(row.cells).every(item => item.rowSpan === 1 && item.colSpan === 1 &&
                    !item.classList.contains("fn__none")));
            while (pureRow && head.lastElementChild !== pureRow) {
                const row = head.lastElementChild as HTMLTableRowElement;
                Array.from(row.cells).forEach(item => replaceCellTag(item, "td"));
                body.insertAdjacentElement("afterbegin", row);
            }
        }
        updateTransaction(this.protyle, this.selection.node, oldHTML);
        const updatedGrid = buildTableGrid(this.selection.table);
        const activeCell = updatedGrid.grid[info.row]?.[info.col];
        if (activeCell) {
            this.selection.cells = new Set([activeCell]);
            this.selection.activeCell = activeCell;
            this.hoverCell = activeCell;
        }
        this.updateSelectedCells(updatedGrid);
        this.scheduleRender();
    }

    private addAtEnd(type: string) {
        const node = getTableNode(this.hoverCell);
        if (!node) {
            return;
        }
        const table = node.querySelector("table") as HTMLTableElement;
        const grid = buildTableGrid(table);
        if (type === "add-row") {
            this.insertRowAt(node, table, grid.rowCount);
        } else {
            this.insertColumnAt(node, table, grid.columnCount);
        }
    }

    private handleDragMove(event: PointerEvent) {
        if (!this.dragState || !this.selection) {
            return;
        }
        if (!this.dragState.dragging &&
            Math.hypot(event.clientX - this.dragState.startX, event.clientY - this.dragState.startY) < 4) {
            return;
        }
        this.dragState.dragging = true;
        const cell = getCell(document.elementFromPoint(event.clientX, event.clientY));
        if (!cell || getTableNode(cell) !== this.selection.node) {
            this.dragState.target = -1;
            this.dropIndicator.classList.add("fn__none");
            return;
        }
        const info = this.dragState.cellInfos.get(cell);
        if (!info) {
            return;
        }
        const rect = this.dragState.mode === "row" ? cell.parentElement.getBoundingClientRect() : cell.getBoundingClientRect();
        const viewportRect = this.getTableViewportRect(this.selection.table);
        const visibleRect = intersectRects(rect, viewportRect);
        if (visibleRect.width === 0 || visibleRect.height === 0) {
            this.dragState.target = -1;
            this.dropIndicator.classList.add("fn__none");
            return;
        }
        const after = this.dragState.mode === "row" ? event.clientY > rect.top + rect.height / 2 :
            event.clientX > rect.left + rect.width / 2;
        this.dragState.target = (this.dragState.mode === "row" ? info.row : info.col) + (after ? 1 : 0);
        this.dropIndicator.classList.remove("fn__none");
        if (this.dragState.mode === "row") {
            this.dropIndicator.classList.add("protyle-table-control__drop--row");
            this.dropIndicator.classList.remove("protyle-table-control__drop--column");
            this.dropIndicator.style.left = `${visibleRect.left}px`;
            this.dropIndicator.style.top = `${after ? Math.min(rect.bottom, viewportRect.bottom) :
                Math.max(rect.top, viewportRect.top)}px`;
            this.dropIndicator.style.width = `${visibleRect.width}px`;
            this.dropIndicator.style.height = "2px";
        } else {
            this.dropIndicator.classList.add("protyle-table-control__drop--column");
            this.dropIndicator.classList.remove("protyle-table-control__drop--row");
            this.dropIndicator.style.left = `${after ? Math.min(rect.right, viewportRect.right) :
                Math.max(rect.left, viewportRect.left)}px`;
            this.dropIndicator.style.top = `${viewportRect.top}px`;
            this.dropIndicator.style.width = "2px";
            this.dropIndicator.style.height = `${viewportRect.height}px`;
        }
    }

    private handleDragEnd(event: PointerEvent) {
        if (!this.dragState) {
            return;
        }
        const state = this.dragState;
        this.dropIndicator.classList.add("fn__none");
        if (state.dragging && state.target >= 0) {
            this.moveSelection(state.target);
            event.preventDefault();
        }
        setTimeout(() => {
            this.dragState = undefined;
        });
    }

    private moveSelection(target: number) {
        if (!this.selection || this.selection.mode === "cell") {
            return;
        }
        const selected = Array.from(this.selection.indexes).sort((a, b) => a - b);
        if (this.selection.mode === "row" && selected.length > 1 && (selected.includes(0) || target === 0)) {
            return;
        }
        const adjustedTarget = target - selected.filter(index => index < target).length;
        const oldHTML = this.selection.node.outerHTML;
        if (this.selection.mode === "row") {
            const rows = Array.from(this.selection.table.rows);
            const moving = selected.map(index => rows[index]).filter(Boolean);
            const remaining = rows.filter((row, index) => !selected.includes(index));
            remaining.splice(Math.max(0, adjustedTarget), 0, ...moving);
            const head = this.selection.table.tHead || this.selection.table.createTHead();
            const body = this.selection.table.tBodies[0] || this.selection.table.createTBody();
            head.innerHTML = "";
            body.innerHTML = "";
            remaining.forEach((row, index) => {
                Array.from(row.cells).forEach(cell => replaceCellTag(cell, index === 0 ? "th" : "td"));
                (index === 0 ? head : body).append(row);
            });
            const start = Math.max(0, adjustedTarget);
            this.selection.indexes = new Set(getRangeIndexes(start, start + moving.length - 1));
            this.selection.activeCell = remaining[start].cells[0];
            this.hoverCell = this.selection.activeCell;
        } else {
            Array.from(this.selection.table.rows).forEach(row => {
                const cells = Array.from(row.cells);
                const moving = selected.map(index => cells[index]).filter(Boolean);
                const remaining = cells.filter((cell, index) => !selected.includes(index));
                remaining.splice(Math.max(0, adjustedTarget), 0, ...moving);
                remaining.forEach(cell => row.append(cell));
            });
            const columns = Array.from(this.selection.table.querySelectorAll("col"));
            if (columns.length > 0) {
                const moving = selected.map(index => columns[index]).filter(Boolean);
                const remaining = columns.filter((column, index) => !selected.includes(index));
                remaining.splice(Math.max(0, adjustedTarget), 0, ...moving);
                remaining.forEach(column => column.parentElement.append(column));
            }
            this.selection.indexes = new Set(getRangeIndexes(adjustedTarget, adjustedTarget + selected.length - 1));
        }
        updateTransaction(this.protyle, this.selection.node, oldHTML);
        this.updateSelectedCells();
        this.scheduleRender();
    }

    private writeClipboard(event: ClipboardEvent) {
        if (!this.selection || !event.clipboardData) {
            return false;
        }
        let html = "";
        if (this.selection.mode === "cell") {
            if (!this.isRectangle()) {
                return false;
            }
            const grid = buildTableGrid(this.selection.table);
            const infos = grid.cellInfos.filter(info => this.selection.cells.has(info.cell));
            const rowStart = Math.min(...infos.map(info => info.row));
            const rowEnd = Math.max(...infos.map(info => info.row + info.rowspan - 1));
            const colStart = Math.min(...infos.map(info => info.col));
            const colEnd = Math.max(...infos.map(info => info.col + info.colspan - 1));
            html = getTableRangeHTML(this.selection.table, grid.grid[rowStart][colStart], grid.grid[rowEnd][colEnd]);
        } else {
            html = this.getCompressedTableHTML();
        }
        if (!html) {
            return false;
        }
        const container = document.createElement("div");
        container.innerHTML = html;
        const rows = Array.from(container.querySelectorAll("tr"));
        const text = rows.map(row => Array.from(row.querySelectorAll("th, td")).filter(cell =>
            !cell.classList.contains("fn__none")).map(cell => getCellText(cell as HTMLTableCellElement)).join("\t")).join("\n");
        const textSiyuan = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeTable" class="table"><div contenteditable="true" spellcheck="false">${html}<div class="protyle-action__table"><div class="table__resize"></div><div class="table__select"></div></div></div><div class="protyle-attr" contenteditable="false">\u200b</div></div>`;
        const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->${removeZWJ(textSiyuan)}`;
        event.clipboardData.setData("text/plain", text);
        event.clipboardData.setData("text/siyuan", textSiyuan);
        event.clipboardData.setData("text/html", textHTML);
        return true;
    }

    private getCompressedTableHTML() {
        const selection = this.selection;
        if (!selection) {
            return "";
        }
        const grid = buildTableGrid(selection.table);
        const rows = selection.mode === "row" ? Array.from(selection.indexes).sort((a, b) => a - b) :
            getRangeIndexes(0, grid.rowCount - 1);
        const columns = selection.mode === "column" ? Array.from(selection.indexes).sort((a, b) => a - b) :
            getRangeIndexes(0, grid.columnCount - 1);
        if (rows.length === 0 || columns.length === 0) {
            return "";
        }
        const rowMap = new Map(rows.map((row, index) => [row, index]));
        const columnMap = new Map(columns.map((column, index) => [column, index]));
        type OutputCell = {
            cell: HTMLTableCellElement;
            row: number;
            column: number;
            rowspan: number;
            colspan: number;
        };
        const outputCells: OutputCell[] = [];
        grid.cellInfos.forEach(info => {
            const selectedRows = rows.filter(row => row >= info.row && row < info.row + info.rowspan);
            const selectedColumns = columns.filter(column => column >= info.col && column < info.col + info.colspan);
            if (selectedRows.length === 0 || selectedColumns.length === 0) {
                return;
            }
            const row = rowMap.get(selectedRows[0]);
            const column = columnMap.get(selectedColumns[0]);
            if (row === undefined || column === undefined) {
                return;
            }
            const cell = info.cell.cloneNode(true) as HTMLTableCellElement;
            cell.classList.remove("fn__none");
            if (selectedRows.length > 1) {
                cell.setAttribute("rowspan", String(selectedRows.length));
            } else {
                cell.removeAttribute("rowspan");
            }
            if (selectedColumns.length > 1) {
                cell.setAttribute("colspan", String(selectedColumns.length));
            } else {
                cell.removeAttribute("colspan");
            }
            outputCells.push({
                cell,
                row,
                column,
                rowspan: selectedRows.length,
                colspan: selectedColumns.length,
            });
        });
        if (outputCells.length === 0) {
            return "";
        }
        const outputGrid: (OutputCell | undefined)[][] = Array.from({length: rows.length},
            () => new Array(columns.length));
        const coveredSlots: boolean[][] = Array.from({length: rows.length},
            () => new Array(columns.length).fill(false));
        outputCells.sort((a, b) => a.row - b.row || a.column - b.column);
        outputCells.forEach(item => {
            outputGrid[item.row][item.column] = item;
            for (let row = item.row; row < item.row + item.rowspan; row++) {
                for (let column = item.column; column < item.column + item.colspan; column++) {
                    if (row !== item.row || column !== item.column) {
                        coveredSlots[row][column] = true;
                    }
                }
            }
        });
        let headRowCount = Math.max(1, rows.filter(row => grid.sectionOfRow[row] === "thead").length);
        let previousHeadRowCount = 0;
        while (headRowCount !== previousHeadRowCount) {
            previousHeadRowCount = headRowCount;
            outputCells.forEach(item => {
                if (item.row < headRowCount) {
                    headRowCount = Math.max(headRowCount, item.row + item.rowspan);
                }
            });
        }
        headRowCount = Math.min(headRowCount, rows.length);
        const sourceColumns = Array.from(selection.table.querySelectorAll(":scope > colgroup > col"));
        let html = "<table><colgroup>";
        columns.forEach(column => {
            html += sourceColumns[column]?.outerHTML || "<col style=\"min-width: 60px;\">";
        });
        html += "</colgroup>";
        let section = "";
        rows.forEach((_, row) => {
            const nextSection = row < headRowCount ? "thead" : "tbody";
            if (section !== nextSection) {
                if (section) {
                    html += `</${section}>`;
                }
                html += `<${nextSection}>`;
                section = nextSection;
            }
            html += "<tr>";
            for (let column = 0; column < columns.length; column++) {
                const item = outputGrid[row][column];
                const tag = nextSection === "thead" ? "th" : "td";
                if (item) {
                    html += replaceCellTag(item.cell, tag).outerHTML;
                } else if (coveredSlots[row][column]) {
                    html += `<${tag} class="fn__none"></${tag}>`;
                } else {
                    html += `<${tag}></${tag}>`;
                }
            }
            html += "</tr>";
        });
        if (section) {
            html += `</${section}>`;
        }
        return `${html}</table>`;
    }
}
