import {hasTopClosestByClassName} from "./hasClosest";
import {hasTableMerge, moveColumnToIndex, moveRowToIndex} from "./table";

const ROW_HANDLE_WIDTH = 10;
const ROW_HANDLE_HEIGHT = 24;
const COL_HANDLE_WIDTH = 20;
const COL_HANDLE_HEIGHT = 14;

type TDragType = "row" | "col";

interface IDragState {
    type: TDragType;
    blockElement: HTMLElement;
    tableElement: HTMLTableElement;
    anchorCell: HTMLTableCellElement;
    sourceIndex: number;
    sourceElements: HTMLElement[];
    sourceRect: DOMRect;
    pointerOffsetX: number;
    pointerOffsetY: number;
}

export class TableDrag {
    private readonly root: HTMLDivElement;
    private readonly rowHandle: HTMLButtonElement;
    private readonly colHandle: HTMLButtonElement;
    private readonly indicator: HTMLDivElement;
    private readonly ghost: HTMLDivElement;
    private readonly protyles = new Set<IProtyle>();
    private activeBlock: HTMLElement | undefined;
    private activeCell: HTMLTableCellElement | undefined;
    private dragState: IDragState | undefined;

    constructor() {
        this.root = document.createElement("div");
        this.root.className = "protyle-table-drag";
        this.rowHandle = this.createHandle("row");
        this.colHandle = this.createHandle("col");
        this.indicator = document.createElement("div");
        this.indicator.className = "protyle-table-drag__indicator";
        this.ghost = document.createElement("div");
        this.ghost.className = "protyle-table-drag__ghost";
        this.root.append(this.rowHandle, this.colHandle, this.indicator, this.ghost);
        document.body.appendChild(this.root);

        document.addEventListener("mousemove", this.onDocumentMouseMove, true);
        document.addEventListener("mousedown", this.onDocumentMouseDown, true);
        document.addEventListener("mouseup", this.onDocumentMouseUp, true);
        document.addEventListener("scroll", this.onDocumentScroll, true);
        window.addEventListener("blur", this.hideAll);
    }

    public register(protyle: IProtyle) {
        this.protyles.add(protyle);
    }

    private createHandle(type: TDragType) {
        const handle = document.createElement("button");
        handle.className = `protyle-table-drag__handle protyle-table-drag__handle--${type}`;
        handle.setAttribute("type", "button");
        handle.setAttribute("tabindex", "-1");
        handle.dataset.type = type;
        handle.addEventListener("mousedown", this.onHandleMouseDown);
        return handle;
    }

    private resolveTarget(target: EventTarget) {
        if (target instanceof HTMLElement) {
            return target;
        }
        if (target instanceof Text) {
            return target.parentElement;
        }
        return undefined;
    }

    private getProtyle(blockElement: HTMLElement) {
        for (const item of this.protyles) {
            if (!item.wysiwyg?.element?.isConnected) {
                this.protyles.delete(item);
                continue;
            }
            if (item.wysiwyg.element.contains(blockElement)) {
                return item;
            }
        }
        return undefined;
    }

    private getTableBlock(target: HTMLElement) {
        const blockElement = hasTopClosestByClassName(target, "table") as HTMLElement;
        if (!blockElement || blockElement.getAttribute("data-type") !== "NodeTable" ||
            blockElement.parentElement?.classList.contains("protyle-wysiwyg__embed")) {
            return undefined;
        }
        const protyle = this.getProtyle(blockElement);
        const tableElement = blockElement.querySelector("table");
        if (!protyle || !tableElement || tableElement.getAttribute("contenteditable") !== "true") {
            return undefined;
        }
        if (protyle.disabled || hasTableMerge(blockElement)) {
            return undefined;
        }
        const tableSelectElement = blockElement.querySelector(".table__select") as HTMLElement;
        if (tableSelectElement?.getAttribute("style")) {
            return undefined;
        }
        return blockElement;
    }

    private getHoverInfo(blockElement: HTMLElement, clientX: number, clientY: number) {
        const tableElement = blockElement.querySelector("table");
        if (!tableElement) {
            return undefined;
        }
        const allRows = Array.from(tableElement.querySelectorAll("thead > tr, tbody > tr")) as HTMLTableRowElement[];
        const firstRow = tableElement.rows[0];
        let rowElement: HTMLTableRowElement | undefined;
        let colIndex: number | undefined;

        allRows.find((item) => {
            const rect = item.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                rowElement = item;
                return true;
            }
            return false;
        });

        if (firstRow) {
            Array.from(firstRow.cells).find((item: HTMLTableCellElement, index) => {
                const rect = item.getBoundingClientRect();
                if (clientX >= rect.left && clientX <= rect.right) {
                    colIndex = index;
                    return true;
                }
                return false;
            });
        }

        let anchorCell: HTMLTableCellElement | undefined;
        if (typeof colIndex === "number" && rowElement?.cells[colIndex]) {
            anchorCell = rowElement.cells[colIndex];
        } else if (rowElement?.cells[0]) {
            anchorCell = rowElement.cells[0];
        } else if (typeof colIndex === "number" && firstRow?.cells[colIndex]) {
            anchorCell = firstRow.cells[colIndex];
        }

        return {
            tableElement,
            rowElement,
            colIndex,
            anchorCell,
        };
    }

    private updateHover(blockElement: HTMLElement, clientX: number, clientY: number) {
        const hoverInfo = this.getHoverInfo(blockElement, clientX, clientY);
        if (!hoverInfo) {
            this.hideAll();
            return;
        }
        this.activeBlock = blockElement;
        this.activeCell = hoverInfo.anchorCell;
        this.updateRowHandle(hoverInfo.tableElement, hoverInfo.rowElement, blockElement);
        this.updateColumnHandle(hoverInfo.tableElement, hoverInfo.colIndex, blockElement);
    }

    private updateRowHandle(tableElement: HTMLTableElement, rowElement: HTMLTableRowElement | undefined, blockElement: HTMLElement) {
        const allRows = Array.from(tableElement.querySelectorAll("thead > tr, tbody > tr")) as HTMLTableRowElement[];
        if (!rowElement || allRows.length < 2) {
            this.hideHandle(this.rowHandle);
            return;
        }
        const rowIndex = allRows.indexOf(rowElement);
        if (rowIndex < 0) {
            this.hideHandle(this.rowHandle);
            return;
        }
        const tableRect = tableElement.getBoundingClientRect();
        const rect = rowElement.getBoundingClientRect();
        const left = tableRect.left - ROW_HANDLE_WIDTH / 2;
        const top = rect.top + rect.height / 2 - ROW_HANDLE_HEIGHT / 2;
        this.positionHandle(this.rowHandle, left, top, rowIndex, blockElement);
    }

    private updateColumnHandle(tableElement: HTMLTableElement, colIndex: number | undefined, blockElement: HTMLElement) {
        const rowElement = tableElement.rows[0];
        if (!rowElement || rowElement.children.length < 2 || typeof colIndex !== "number" || !rowElement.cells[colIndex]) {
            this.hideHandle(this.colHandle);
            return;
        }
        const tableRect = tableElement.getBoundingClientRect();
        const rect = rowElement.cells[colIndex].getBoundingClientRect();
        const left = rect.left + rect.width / 2 - COL_HANDLE_WIDTH / 2;
        const top = tableRect.top - COL_HANDLE_HEIGHT / 2;
        this.positionHandle(this.colHandle, left, top, colIndex, blockElement);
    }

    private positionHandle(handle: HTMLButtonElement, left: number, top: number, index: number, blockElement: HTMLElement) {
        handle.style.left = `${Math.round(left)}px`;
        handle.style.top = `${Math.round(top)}px`;
        handle.dataset.index = index.toString();
        handle.dataset.blockId = blockElement.getAttribute("data-node-id");
        handle.classList.add("protyle-table-drag__handle--show");
    }

    private hideHandle(handle: HTMLButtonElement) {
        handle.classList.remove("protyle-table-drag__handle--show");
        handle.removeAttribute("data-index");
        handle.removeAttribute("data-block-id");
    }

    private hideIndicator() {
        this.indicator.className = "protyle-table-drag__indicator";
        this.indicator.removeAttribute("style");
    }

    private hideGhost() {
        this.ghost.className = "protyle-table-drag__ghost";
        this.ghost.removeAttribute("style");
        this.ghost.innerHTML = "";
    }

    private hideAll = () => {
        this.dragState?.sourceElements.forEach((item) => {
            item.classList.remove("protyle-table-drag__source");
        });
        this.dragState?.blockElement.classList.remove("protyle-table-drag--active");
        this.activeBlock = undefined;
        this.activeCell = undefined;
        this.dragState = undefined;
        this.root.classList.remove("protyle-table-drag--dragging");
        document.body.classList.remove("fn__selectnone");
        this.hideHandle(this.rowHandle);
        this.hideHandle(this.colHandle);
        this.hideIndicator();
        this.hideGhost();
    };

    private onDocumentMouseDown = (event: MouseEvent) => {
        const target = this.resolveTarget(event.target);
        if (!target) {
            this.hideAll();
            return;
        }
        if (this.root.contains(target)) {
            return;
        }
        if (hasTopClosestByClassName(target, "protyle-wysiwyg")) {
            if (!this.getTableBlock(target)) {
                this.hideAll();
            }
            return;
        }
        this.hideAll();
    };

    private onHandleMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) {
            return;
        }
        const handle = event.currentTarget as HTMLButtonElement;
        const type = handle.dataset.type as TDragType;
        const sourceIndex = parseInt(handle.dataset.index, 10);
        if (!this.activeBlock || !this.activeCell || Number.isNaN(sourceIndex)) {
            return;
        }
        const tableElement = this.activeBlock.querySelector("table");
        if (!tableElement) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const dragState = this.createDragState(type, sourceIndex, event, tableElement);
        if (!dragState) {
            return;
        }
        dragState.sourceElements.forEach((item) => {
            item.classList.add("protyle-table-drag__source");
        });
        dragState.blockElement.classList.add("protyle-table-drag--active");
        this.dragState = dragState;
        this.root.classList.add("protyle-table-drag--dragging");
        document.body.classList.add("fn__selectnone");
        this.hideHandle(this.rowHandle);
        this.hideHandle(this.colHandle);
        this.updateGhostPosition(event.clientX, event.clientY);
    };

    private onDocumentMouseMove = (event: MouseEvent) => {
        if (this.dragState) {
            this.updateDrag(event);
            return;
        }

        const target = this.resolveTarget(event.target);
        if (!target || this.root.contains(target)) {
            return;
        }
        if (event.buttons !== 0) {
            this.hideAll();
            return;
        }
        if (target.classList.contains("table__resize") || target.classList.contains("table__select")) {
            this.hideAll();
            return;
        }

        const blockElement = this.getTableBlock(target);
        if (!blockElement) {
            this.hideAll();
            return;
        }
        this.updateHover(blockElement, event.clientX, event.clientY);
    };

    private onDocumentMouseUp = (event: MouseEvent) => {
        if (!this.dragState) {
            return;
        }

        event.preventDefault();

        const {blockElement, type, anchorCell} = this.dragState;
        const protyle = this.getProtyle(blockElement);
        const targetIndex = parseInt(this.indicator.dataset.index || "", 10);
        const hadIndicator = this.indicator.classList.contains("protyle-table-drag__indicator--show");

        this.hideAll();
        if (!hadIndicator || Number.isNaN(targetIndex) || !protyle) {
            return;
        }

        if (type === "row") {
            const rowElement = anchorCell.parentElement as HTMLTableRowElement;
            if (rowElement) {
                const range = document.createRange();
                range.selectNodeContents(anchorCell);
                range.collapse(true);
                moveRowToIndex(protyle, range, rowElement, blockElement, targetIndex);
            }
        } else {
            const range = document.createRange();
            range.selectNodeContents(anchorCell);
            range.collapse(true);
            moveColumnToIndex(protyle, range, anchorCell, blockElement, targetIndex);
        }

        const pointTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
        if (pointTarget) {
            const pointBlockElement = this.getTableBlock(pointTarget);
            if (pointBlockElement) {
                this.updateHover(pointBlockElement, event.clientX, event.clientY);
            }
        }
    };

    private onDocumentScroll = () => {
        if (this.dragState) {
            this.hideIndicator();
            this.hideGhost();
            return;
        }
        if (this.activeBlock && this.activeCell?.isConnected) {
            const rect = this.activeCell.getBoundingClientRect();
            this.updateHover(this.activeBlock, rect.left + rect.width / 2, rect.top + rect.height / 2);
            return;
        }
        this.hideAll();
    };

    private updateDrag(event: MouseEvent) {
        const {type, tableElement, sourceIndex} = this.dragState;
        this.updateGhostPosition(event.clientX, event.clientY);
        if (type === "row") {
            this.updateRowIndicator(tableElement, this.getRowDropIndex(tableElement, sourceIndex, event.clientY));
        } else {
            this.updateColumnIndicator(tableElement, this.getColumnDropIndex(tableElement, sourceIndex, event.clientX));
        }
    }

    private getRowDropIndex(tableElement: HTMLTableElement, sourceIndex: number, clientY: number) {
        const rows = Array.from(tableElement.querySelectorAll("thead > tr, tbody > tr")) as HTMLTableRowElement[];
        if (rows.length < 2) {
            return -1;
        }
        const currentTop = clientY - this.dragState.pointerOffsetY;
        const currentBottom = currentTop + this.dragState.sourceRect.height;
        if (currentBottom > this.dragState.sourceRect.bottom) {
            let targetIndex = -1;
            for (let i = sourceIndex + 1; i < rows.length; i++) {
                const rowRect = rows[i].getBoundingClientRect();
                if (currentBottom > rowRect.top + rowRect.height / 2) {
                    targetIndex = i + 1;
                } else {
                    break;
                }
            }
            return targetIndex;
        }
        if (currentTop < this.dragState.sourceRect.top) {
            let targetIndex = -1;
            for (let i = sourceIndex - 1; i >= 0; i--) {
                const rowRect = rows[i].getBoundingClientRect();
                if (currentTop < rowRect.top + rowRect.height / 2) {
                    targetIndex = i;
                } else {
                    break;
                }
            }
            return targetIndex;
        }
        return -1;
    }

    private getColumnDropIndex(tableElement: HTMLTableElement, sourceIndex: number, clientX: number) {
        const rowElement = tableElement.rows[0];
        if (!rowElement || rowElement.cells.length < 2) {
            return -1;
        }
        const currentLeft = clientX - this.dragState.pointerOffsetX;
        const currentRight = currentLeft + this.dragState.sourceRect.width;
        if (currentRight > this.dragState.sourceRect.right) {
            let targetIndex = -1;
            for (let i = sourceIndex + 1; i < rowElement.cells.length; i++) {
                const cellRect = rowElement.cells[i].getBoundingClientRect();
                if (currentRight > cellRect.left + cellRect.width / 2) {
                    targetIndex = i + 1;
                } else {
                    break;
                }
            }
            return targetIndex;
        }
        if (currentLeft < this.dragState.sourceRect.left) {
            let targetIndex = -1;
            for (let i = sourceIndex - 1; i >= 0; i--) {
                const cellRect = rowElement.cells[i].getBoundingClientRect();
                if (currentLeft < cellRect.left + cellRect.width / 2) {
                    targetIndex = i;
                } else {
                    break;
                }
            }
            return targetIndex;
        }
        return -1;
    }

    private updateRowIndicator(tableElement: HTMLTableElement, targetIndex: number) {
        const rows = Array.from(tableElement.querySelectorAll("thead > tr, tbody > tr")) as HTMLTableRowElement[];
        if (targetIndex < 0 || rows.length < 2) {
            this.hideIndicator();
            return;
        }

        let top = rows[0].getBoundingClientRect().top;
        if (targetIndex < rows.length) {
            top = rows[targetIndex].getBoundingClientRect().top;
        } else {
            top = rows[rows.length - 1].getBoundingClientRect().bottom;
        }

        const tableRect = tableElement.getBoundingClientRect();
        this.indicator.className = "protyle-table-drag__indicator protyle-table-drag__indicator--row protyle-table-drag__indicator--show";
        this.indicator.dataset.index = targetIndex.toString();
        this.indicator.style.left = `${Math.round(tableRect.left)}px`;
        this.indicator.style.top = `${Math.round(top - 1)}px`;
        this.indicator.style.width = `${Math.round(tableRect.width)}px`;
    }

    private updateColumnIndicator(tableElement: HTMLTableElement, targetIndex: number) {
        const rowElement = tableElement.rows[0];
        if (!rowElement || rowElement.cells.length < 2 || targetIndex < 0) {
            this.hideIndicator();
            return;
        }

        let left = rowElement.cells[0].getBoundingClientRect().left;
        if (targetIndex < rowElement.cells.length) {
            left = rowElement.cells[targetIndex].getBoundingClientRect().left;
        } else {
            left = rowElement.cells[rowElement.cells.length - 1].getBoundingClientRect().right;
        }

        const tableRect = tableElement.getBoundingClientRect();
        this.indicator.className = "protyle-table-drag__indicator protyle-table-drag__indicator--col protyle-table-drag__indicator--show";
        this.indicator.dataset.index = targetIndex.toString();
        this.indicator.style.left = `${Math.round(left - 1)}px`;
        this.indicator.style.top = `${Math.round(tableRect.top)}px`;
        this.indicator.style.height = `${Math.round(tableRect.height)}px`;
    }

    private createDragState(type: TDragType, sourceIndex: number, event: MouseEvent, tableElement: HTMLTableElement) {
        if (type === "row") {
            const rowElement = Array.from(tableElement.querySelectorAll("thead > tr, tbody > tr"))[sourceIndex] as HTMLTableRowElement;
            if (!rowElement) {
                return undefined;
            }
            const rowRect = rowElement.getBoundingClientRect();
            const cellRects = Array.from(rowElement.cells).map((item) => item.getBoundingClientRect());
            this.ghost.className = "protyle-table-drag__ghost protyle-table-drag__ghost--row";
            this.ghost.style.width = `${Math.round(rowRect.width)}px`;
            this.ghost.style.gridTemplateColumns = cellRects.map((item) => `${Math.round(item.width)}px`).join(" ");
            Array.from(rowElement.cells).forEach((item: HTMLTableCellElement, index) => {
                this.ghost.appendChild(this.cloneCell(item, cellRects[index]));
            });
            return {
                type,
                blockElement: this.activeBlock,
                tableElement,
                anchorCell: this.activeCell,
                sourceIndex,
                sourceElements: [rowElement],
                sourceRect: rowRect,
                pointerOffsetX: event.clientX - rowRect.left,
                pointerOffsetY: event.clientY - rowRect.top,
            };
        }

        const sourceCells: HTMLElement[] = [];
        let sourceRect: DOMRect | undefined;
        Array.from(tableElement.rows).forEach((rowElement: HTMLTableRowElement) => {
            const cellElement = rowElement.cells[sourceIndex] as HTMLTableCellElement;
            if (!cellElement) {
                return;
            }
            const rect = cellElement.getBoundingClientRect();
            if (!sourceRect) {
                sourceRect = rect;
                this.ghost.className = "protyle-table-drag__ghost protyle-table-drag__ghost--col";
                this.ghost.style.width = `${Math.round(rect.width)}px`;
            }
            sourceCells.push(cellElement);
            this.ghost.appendChild(this.cloneCell(cellElement, rect));
        });
        if (!sourceRect || sourceCells.length === 0) {
            return undefined;
        }
        return {
            type,
            blockElement: this.activeBlock,
            tableElement,
            anchorCell: this.activeCell,
            sourceIndex,
            sourceElements: sourceCells,
            sourceRect,
            pointerOffsetX: event.clientX - sourceRect.left,
            pointerOffsetY: event.clientY - sourceRect.top,
        };
    }

    private cloneCell(cellElement: HTMLTableCellElement, rect: DOMRect) {
        const computedStyle = window.getComputedStyle(cellElement);
        const cloneElement = document.createElement("div");
        cloneElement.classList.add("protyle-table-drag__ghost-cell");
        cloneElement.innerHTML = cellElement.innerHTML;
        cloneElement.style.width = `${Math.round(rect.width)}px`;
        cloneElement.style.height = `${Math.round(rect.height)}px`;
        cloneElement.style.padding = computedStyle.padding;
        cloneElement.style.borderTop = computedStyle.borderTop;
        cloneElement.style.borderRight = computedStyle.borderRight;
        cloneElement.style.borderBottom = computedStyle.borderBottom;
        cloneElement.style.borderLeft = computedStyle.borderLeft;
        cloneElement.style.background = computedStyle.background;
        cloneElement.style.color = computedStyle.color;
        cloneElement.style.font = computedStyle.font;
        cloneElement.style.textAlign = computedStyle.textAlign;
        cloneElement.style.verticalAlign = computedStyle.verticalAlign;
        cloneElement.style.display = "flex";
        cloneElement.style.alignItems = "center";
        cloneElement.querySelectorAll("[contenteditable]").forEach((item: HTMLElement) => {
            item.setAttribute("contenteditable", "false");
        });
        return cloneElement;
    }

    private updateGhostPosition(clientX: number, clientY: number) {
        if (!this.dragState) {
            return;
        }
        const {type, sourceRect, pointerOffsetX, pointerOffsetY} = this.dragState;
        this.ghost.classList.add("protyle-table-drag__ghost--show");
        if (type === "row") {
            this.ghost.style.left = `${Math.round(sourceRect.left)}px`;
            this.ghost.style.top = `${Math.round(clientY - pointerOffsetY)}px`;
            return;
        }
        this.ghost.style.left = `${Math.round(clientX - pointerOffsetX)}px`;
        this.ghost.style.top = `${Math.round(sourceRect.top)}px`;
    }
}

let tableDragInstance: TableDrag | undefined;

export const initTableDrag = (protyle: IProtyle) => {
    if (!tableDragInstance) {
        tableDragInstance = new TableDrag();
    }
    tableDragInstance.register(protyle);
};
