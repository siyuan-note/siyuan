import {MenuItem} from "../../menus/Menu";
import {updateTransaction} from "../wysiwyg/transaction";
import {copyPlainText, encodeBase64, isMac, readClipboard} from "./compatibility";
import {removeZWJ} from "./normalizeText";
import {paste} from "./paste";
import {focusByRange, getEditorRange} from "./selection";
import {
    buildTableGrid,
    deleteTableColumns,
    deleteTableRows,
    getTableCellSelectionIndexes,
    getTableRangeHTML,
    isTableHeaderEnabled,
    ITableCellInfo,
    ITableGrid,
    toggleTableHeader,
} from "./table";
import {
    constrainTableResizeCount,
    getTableResizeControlCenter,
    getTableResizeCount,
    isTableCellContentEmpty,
    isTableResizeControlVisible,
} from "./tableResize";
import {applyTableCellStyleHotkey, getTableCellTextStyleMenus} from "../toolbar/tableCell";
import {getTableCellsInRectangle, getTableDragEdge} from "./tableSelection";

type TableSelectionMode = "row" | "column" | "cell";
type TableAddControlType = "add-row" | "add-column" | "add-both";
type TableControlType = TableSelectionMode | TableAddControlType;

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
    handleCenter: number;
    handleSize: number;
    cellInfos: Map<HTMLTableCellElement, ITableCellInfo>;
}

interface IResizeState {
    mode: "row" | "column" | "both";
    node: HTMLElement;
    table: HTMLTableElement;
    tableHTML: string;
    oldHTML: string;
    pointerId: number;
    startX: number;
    startY: number;
    pointerX: number;
    pointerY: number;
    startRows: number;
    startColumns: number;
    targetRows: number;
    targetColumns: number;
    minRows: number;
    minColumns: number;
    invalidRowCounts: Set<number>;
    invalidColumnCounts: Set<number>;
    rowSizes: number[];
    columnSizes: number[];
    addedRowSize: number;
    addedColumnSize: number;
    dragging: boolean;
    cleanup?: () => void;
}

interface ITableControlRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface ITableEdgeHover {
    cell: HTMLTableCellElement;
    type: TableAddControlType;
    distance: number;
}

const getCell = (target: EventTarget | Node) => {
    const element = target instanceof Element ? target : (target as Node)?.parentElement;
    return element?.closest?.("th, td") as HTMLTableCellElement;
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

export const getCommonTableCellStyle = (cells: HTMLTableCellElement[], property: string) => {
    if (cells.length === 0) {
        return undefined;
    }
    const value = cells[0].style.getPropertyValue(property);
    return cells.every(cell => cell.style.getPropertyValue(property) === value) ? value : undefined;
};

export const setTableCellStyle = (protyle: IProtyle, node: HTMLElement, cells: HTMLTableCellElement[],
                                  property: string, value: string) => {
    const oldHTML = node.outerHTML;
    cells.forEach(cell => {
        if (value) {
            cell.style.setProperty(property, value);
        } else {
            cell.style.removeProperty(property);
            if (!cell.getAttribute("style")) {
                cell.removeAttribute("style");
            }
        }
    });
    updateTransaction(protyle, node, oldHTML);
};

export const getTableCellBackgroundMenus = (cells: HTMLTableCellElement[],
                                             onChange: (color: string) => void): IMenu[] => {
    const backgroundColor = getCommonTableCellStyle(cells, "background-color");
    const colors = ["", ...Array.from({length: 13}, (_, index) => `var(--b3-font-background${index + 1})`)];
    const colorHTML = colors.map(color => {
        const currentClass = backgroundColor === color ? " color__square--current" : "";
        const defaultClass = color ? "" : " ariaLabel";
        const attributes = color ? ` style="background-color:${color}"` :
            ` aria-label="${window.siyuan.languages.default}" data-position="3south"`;
        return `<button type="button" data-color="${color}" class="color__square${currentClass}${defaultClass}"${attributes}></button>`;
    }).join("");
    return [{
        type: "empty",
        label: `<div class="fn__flex fn__flex-wrap" style="width: 238px">${colorHTML}</div>`,
        bind: element => {
            element.addEventListener("click", event => {
                const colorTarget = (event.target as Element).closest<HTMLElement>(".color__square");
                if (!colorTarget || !element.contains(colorTarget)) {
                    return;
                }
                onChange(colorTarget.dataset.color);
                window.siyuan.menus.menu.remove();
            });
        },
    }];
};

export const getTableCellAlignmentMenus = (
    cells: HTMLTableCellElement[],
    onChange: (property: string, value: string) => void,
): IMenu[] => {
    const textAlign = getCommonTableCellStyle(cells, "text-align");
    return [{
        id: "alignLeft",
        icon: "iconAlignLeft",
        accelerator: window.siyuan.config.keymap.editor.general.alignLeft.custom,
        label: window.siyuan.languages.alignLeft,
        checked: textAlign === "left",
        click: () => onChange("text-align", "left"),
    }, {
        id: "alignCenter",
        icon: "iconAlignCenter",
        accelerator: window.siyuan.config.keymap.editor.general.alignCenter.custom,
        label: window.siyuan.languages.alignCenter,
        checked: textAlign === "center",
        click: () => onChange("text-align", "center"),
    }, {
        id: "alignRight",
        icon: "iconAlignRight",
        accelerator: window.siyuan.config.keymap.editor.general.alignRight.custom,
        label: window.siyuan.languages.alignRight,
        checked: textAlign === "right",
        click: () => onChange("text-align", "right"),
    }, {
        id: "useDefaultHorizontalAlign",
        label: window.siyuan.languages.useDefaultHorizontalAlign,
        checked: textAlign === "",
        click: () => onChange("text-align", ""),
    }, {
        type: "separator",
    }, ...getTableCellVerticalAlignmentMenus(cells, onChange)];
};

export const getTableCellVerticalAlignmentMenus = (
    cells: HTMLTableCellElement[],
    onChange: (property: string, value: string) => void,
): IMenu[] => {
    const verticalAlign = getCommonTableCellStyle(cells, "vertical-align");
    return [{
        id: "alignTop",
        icon: "iconAlignTop",
        label: window.siyuan.languages.alignTop,
        checked: verticalAlign === "top",
        click: () => onChange("vertical-align", "top"),
    }, {
        id: "alignMiddle",
        icon: "iconAlignMiddle",
        label: window.siyuan.languages.alignMiddle,
        checked: verticalAlign === "middle",
        click: () => onChange("vertical-align", "middle"),
    }, {
        id: "alignBottom",
        icon: "iconAlignBottom",
        label: window.siyuan.languages.alignBottom,
        checked: verticalAlign === "bottom",
        click: () => onChange("vertical-align", "bottom"),
    }, {
        id: "useDefaultVerticalAlign",
        label: window.siyuan.languages.useDefaultVerticalAlign,
        checked: verticalAlign === "",
        click: () => onChange("vertical-align", ""),
    }];
};

const TABLE_HANDLE_THICKNESS = 16;
const TABLE_ADD_CONTROL_THICKNESS = 16;
const TABLE_ADD_CONTROL_GAP = 10;
const TABLE_EDGE_CONTROL_TRIGGER_SIZE = 8;
const TABLE_DEFAULT_COLUMN_WIDTH = 60;
const TABLE_RESIZE_DRAG_THRESHOLD = 4;
const TABLE_NON_TEXT_CONTENT_SELECTOR = "img, audio, video, iframe, canvas, svg, math, input, textarea, select, button, object, embed";

export class TableControl {
    private protyle: IProtyle;
    private wysiwygElement: HTMLElement;
    private element: HTMLElement;
    private rowHandle: HTMLButtonElement;
    private columnHandle: HTMLButtonElement;
    private cellHandle: HTMLButtonElement;
    private addRowButton: HTMLButtonElement;
    private addColumnButton: HTMLButtonElement;
    private addBothButton: HTMLButtonElement;
    private resizeLabel: HTMLElement;
    private dropIndicator: HTMLElement;
    private selection: ITableSelection;
    private hoverCell: HTMLTableCellElement;
    private caretCell: HTMLTableCellElement;
    private hoverType: TableControlType;
    private selectionElements: HTMLElement[] = [];
    private selectionElementIndex = 0;
    private selectedCells: HTMLTableCellElement[] = [];
    private selectionGrid: ITableGrid;
    private frame: number;
    private dragState: IDragState;
    private resizeState: IResizeState;
    private suppressAddClick = false;
    private bypassClipboardEvent = false;
    private observer: MutationObserver;
    private pinnedTableResizeObserver: ResizeObserver;
    private pinnedTableActions = new Map<HTMLTableElement, HTMLElement>();
    private abortController = new AbortController();

    constructor(protyle: IProtyle, wysiwygElement: HTMLElement) {
        this.protyle = protyle;
        this.wysiwygElement = wysiwygElement;
        this.element = document.createElement("div");
        this.element.className = "protyle-table-control";
        this.element.setAttribute("contenteditable", "false");
        this.element.innerHTML = `<button type="button" class="protyle-table-control__handle protyle-table-control__handle--row fn__none" data-type="row" aria-label="${window.siyuan.languages.row}">
    <svg><use xlink:href="#iconDrag"></use></svg>
</button>
<button type="button" class="protyle-table-control__handle protyle-table-control__handle--column fn__none" data-type="column" aria-label="${window.siyuan.languages.column}">
    <svg><use xlink:href="#iconDrag"></use></svg>
</button>
<button type="button" class="protyle-table-control__handle protyle-table-control__handle--cell ariaLabel fn__none" data-type="cell" data-position="north" aria-label="${window.siyuan.languages.more}">
    <svg><use xlink:href="#iconMore"></use></svg>
</button>
<button type="button" class="protyle-table-control__add protyle-table-control__add--row ariaLabel fn__none" data-type="add-row" data-position="north" aria-label="${window.siyuan.languages.tableAddRowTip}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</button>
<button type="button" class="protyle-table-control__add protyle-table-control__add--column ariaLabel fn__none" data-type="add-column" data-position="west" aria-label="${window.siyuan.languages.tableAddColumnTip}">
    <svg><use xlink:href="#iconAdd"></use></svg>
</button>
<button type="button" class="protyle-table-control__add protyle-table-control__add--both fn__none" data-type="add-both" aria-label="${window.siyuan.languages.insertRowBelow} ${window.siyuan.languages.insertColumnRight}">
    <svg><use xlink:href="#iconMove"></use></svg>
</button>
<div class="protyle-table-control__size fn__none"></div>
<div class="protyle-table-control__drop fn__none"></div>`;
        this.rowHandle = this.element.querySelector('[data-type="row"]');
        this.columnHandle = this.element.querySelector('[data-type="column"]');
        this.cellHandle = this.element.querySelector('[data-type="cell"]');
        this.addRowButton = this.element.querySelector('[data-type="add-row"]');
        this.addColumnButton = this.element.querySelector('[data-type="add-column"]');
        this.addBothButton = this.element.querySelector('[data-type="add-both"]');
        this.resizeLabel = this.element.querySelector(".protyle-table-control__size");
        this.dropIndicator = this.element.querySelector(".protyle-table-control__drop");
        protyle.element.append(this.element);
        this.bindEvents();
        this.pinnedTableResizeObserver = new ResizeObserver(() => this.scheduleRender());
        this.observer = new MutationObserver(mutations => {
            if (this.resizeState && !this.resizeState.node.isConnected) {
                this.resizeState = undefined;
                this.resizeLabel.classList.add("fn__none");
            }
            if (this.selection && (!this.selection.node.isConnected || !this.selection.activeCell.isConnected)) {
                this.clear();
                return;
            }
            let render = false;
            if (this.hoverCell && !this.hoverCell.isConnected) {
                this.hoverCell = undefined;
                this.hoverType = undefined;
                render = true;
            }
            if (this.caretCell && !this.caretCell.isConnected) {
                this.caretCell = undefined;
                render = true;
            }
            const controlTables = [
                this.hoverCell?.closest("table"),
                this.caretCell?.closest("table"),
                this.selection?.table,
            ].filter((table): table is HTMLTableElement => !!table?.isConnected);
            if (mutations.some(mutation => controlTables.some(table => table.contains(mutation.target)))) {
                render = true;
            }
            const pinnedTableSelector = '[data-type="NodeTable"][custom-pinthead="true"]';
            if (mutations.some(mutation => mutation.type === "attributes" ||
                (mutation.target instanceof Element && !!mutation.target.closest(pinnedTableSelector)) ||
                [...mutation.addedNodes, ...mutation.removedNodes].some(node => node instanceof Element &&
                    (node.matches(pinnedTableSelector) || !!node.querySelector(pinnedTableSelector))))) {
                render = true;
            }
            if (render) {
                this.scheduleRender();
            }
        });
        this.observer.observe(this.wysiwygElement, {
            attributeFilter: ["custom-pinthead"],
            attributes: true,
            childList: true,
            characterData: true,
            subtree: true,
        });
        this.scheduleRender();
    }

    public destroy() {
        this.cancelResize();
        this.abortController.abort();
        this.observer.disconnect();
        this.pinnedTableResizeObserver.disconnect();
        this.pinnedTableActions.forEach(action => this.clearPinnedTableFrame(action));
        this.pinnedTableActions.clear();
        cancelAnimationFrame(this.frame);
        this.element.remove();
    }

    public clear() {
        this.cancelResize();
        this.clearDragPreview();
        this.dragState = undefined;
        this.selection = undefined;
        this.selectionGrid = undefined;
        this.selectedCells = [];
        this.selectionElements.forEach(item => item.remove());
        this.selectionElements = [];
        this.selectionElementIndex = 0;
        this.dropIndicator.classList.add("fn__none");
        this.resizeLabel.classList.add("fn__none");
        this.scheduleRender();
    }

    public setHidden(hidden: boolean) {
        this.element.classList.toggle("fn__none", hidden);
        if (!hidden) {
            this.scheduleRender();
        }
    }

    public selectCellRange(anchorCell: HTMLTableCellElement, activeCell: HTMLTableCellElement) {
        const node = getTableNode(anchorCell);
        const table = anchorCell?.closest("table") as HTMLTableElement;
        if (!node || !table || getTableNode(activeCell) !== node || activeCell.closest("table") !== table) {
            return false;
        }
        const grid = buildTableGrid(table);
        const anchorInfo = grid.cellInfos.find(item => item.cell === anchorCell);
        const activeInfo = grid.cellInfos.find(item => item.cell === activeCell);
        const cells = getTableCellsInRectangle(grid.cellInfos, anchorInfo, activeInfo).map(item => item.cell);
        if (cells.length === 0) {
            return false;
        }
        node.querySelector(".table__select")?.removeAttribute("style");
        this.selection = {
            node,
            table,
            mode: "cell",
            indexes: new Set(),
            cells: new Set(cells),
            anchor: anchorCell,
            activeCell,
        };
        this.caretCell = undefined;
        this.updateSelectedCells(grid);
        getSelection()?.removeAllRanges();
        this.scheduleRender();
        return true;
    }

    private bindEvents() {
        const signal = this.abortController.signal;
        document.addEventListener("selectionchange", () => {
            const selection = getSelection();
            const cell = selection?.isCollapsed ? getCell(selection.focusNode) : undefined;
            const caretCell = cell && this.wysiwygElement.contains(cell) ? cell : undefined;
            if (caretCell !== this.caretCell) {
                this.caretCell = caretCell;
                this.scheduleRender();
            }
        }, {signal});
        this.wysiwygElement.addEventListener("pointermove", event => this.handleTablePointerMove(event, false), {signal});
        // 手柄和添加按钮（pointer-events: auto）会截获鼠标事件，导致 wysiwygElement 收不到
        // pointermove，边缘 hover 检测被卡住（例如鼠标停在 cell 手柄上时无法触发 add-column）。
        // 控件容器位于事件冒泡路径上，在这里兜底执行相同的边缘检测
        this.element.addEventListener("pointermove", event => this.handleTablePointerMove(event, true), {signal});
        this.wysiwygElement.addEventListener("pointerleave", event => {
            if (this.dragState || this.resizeState || this.element.contains(event.relatedTarget as Node)) {
                return;
            }
            this.hoverCell = undefined;
            this.hoverType = undefined;
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
            if (!this.selection || this.protyle.disabled) {
                return;
            }
            if (!event.isComposing && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
                (event.key === "Backspace" || event.key === "Delete")) {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.deleteSelection(true);
                return;
            }
            if (applyTableCellStyleHotkey(this.protyle, this.getSelectedCells(), event, () => this.scheduleRender())) {
                return;
            }
        }, {capture: true, signal});
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") {
                return;
            }
            if (this.resizeState) {
                this.cancelResize();
            } else if (this.selection) {
                this.clear();
            }
        }, {signal});
        document.addEventListener("pointerdown", event => {
            const target = event.target as Node;
            if (!this.selection) {
                if (this.caretCell && !this.element.contains(target) && !this.wysiwygElement.contains(target)) {
                    this.caretCell = undefined;
                    this.scheduleRender();
                }
                return;
            }
            if (this.element.contains(target) || this.selection.node.contains(target) ||
                document.getElementById("commonMenu")?.contains(target)) {
                return;
            }
            this.clear();
        }, {capture: true, signal});
        document.addEventListener("copy", event => {
            if (!this.selection || this.bypassClipboardEvent) {
                return;
            }
            this.writeClipboard(event);
            event.preventDefault();
            event.stopImmediatePropagation();
        }, {capture: true, signal});
        document.addEventListener("cut", event => {
            if (!this.selection || this.bypassClipboardEvent) {
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
        document.addEventListener("paste", () => {
            if (!this.selection || this.protyle.disabled) {
                return;
            }
            const cell = this.getSelectedCells()[0];
            if (!cell) {
                return;
            }
            const range = getEditorRange(cell);
            range.selectNodeContents(cell);
            range.collapse(true);
            focusByRange(range);
        }, {capture: true, signal});
        this.protyle.element.addEventListener("scroll", () => this.scheduleRender(), {capture: true, signal});
        window.addEventListener("resize", () => this.scheduleRender(), {signal});
        this.element.addEventListener("wheel", event => {
            if (event.ctrlKey) {
                return;
            }
            event.preventDefault();
            this.protyle.contentElement.scrollBy({
                left: event.deltaX,
                top: event.deltaY,
            });
        }, {passive: false, signal});
        this.element.addEventListener("pointerdown", event => this.handlePointerDown(event), {signal});
        this.element.addEventListener("click", event => this.handleClick(event), {signal});
        this.element.addEventListener("contextmenu", event => {
            const type = (event.target as Element).closest<HTMLElement>("[data-type]")?.dataset.type;
            const cell = this.getControlCell(type);
            if (!cell || (type !== "row" && type !== "column" && type !== "cell")) {
                return;
            }
            if (!this.selection || this.selection.mode !== type || !this.isCellInSelection(cell)) {
                this.selectFromCell(type, cell, false, false);
            }
            event.preventDefault();
            event.stopPropagation();
            this.openMenu(event.clientX, event.clientY);
        }, {signal});
        this.element.addEventListener("pointerleave", event => {
            if (this.dragState || this.wysiwygElement.contains(event.relatedTarget as Node)) {
                return;
            }
            this.hoverCell = undefined;
            this.hoverType = undefined;
            this.scheduleRender();
        }, {signal});
    }

    private handleTablePointerMove(event: PointerEvent, fromControl: boolean) {
        if (event.buttons !== 0) {
            return;
        }
        const targetCell = getCell(event.target);
        const targetTable = targetCell?.closest("table") as HTMLTableElement;
        const targetViewportRect = targetTable ? this.getTableGridViewportRect(targetTable) : undefined;
        const edgeHover = !targetCell || (targetViewportRect &&
            event.clientX <= targetViewportRect.left + TABLE_EDGE_CONTROL_TRIGGER_SIZE) ?
            this.getEdgeHover(event.clientX, event.clientY) : undefined;
        const cell = edgeHover?.cell || targetCell;
        if (cell && getTableNode(cell) && !this.protyle.disabled) {
            const hoverType = edgeHover?.type || "cell";
            if (cell === this.hoverCell && hoverType === this.hoverType) {
                return;
            }
            this.hoverCell = cell;
            this.hoverType = hoverType;
            this.scheduleRender();
            return;
        }
        // 控件按钮（手柄/添加按钮）上的事件不会到达 wysiwygElement，这里只在
        // 非控件来源时清空 hover 状态，避免鼠标悬停在按钮上时状态被错误清除
        if (!fromControl && this.hoverCell) {
            this.hoverCell = undefined;
            this.hoverType = undefined;
            this.scheduleRender();
        }
    }

    private getControlCell(type?: string) {
        if (type === "cell") {
            return this.selection?.mode === "cell" ? this.selection.activeCell : this.caretCell;
        }
        if (type === "add-row" || type === "add-column" || type === "add-both") {
            return this.hoverCell;
        }
        return this.hoverCell || this.caretCell ||
            (this.selection?.mode === type ? this.selection.activeCell : undefined);
    }

    private handlePointerDown(event: PointerEvent) {
        const type = (event.target as Element).closest<HTMLElement>("[data-type]")?.dataset.type;
        const cell = this.getControlCell(type);
        if (!type || !cell) {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (type === "add-row" || type === "add-column" || type === "add-both") {
            this.startResize(event, type);
            return;
        }
        if (type !== "row" && type !== "column") {
            return;
        }
        this.selectFromCell(type, cell, isPrimaryModifier(event), event.shiftKey);
        if (!this.selection) {
            return;
        }
        const grid = buildTableGrid(this.selection.table);
        if (grid.cellInfos.some(info => info.rowspan > 1 || info.colspan > 1) ||
            (type === "row" && this.selection.indexes.size > 1 && this.selection.indexes.has(0))) {
            return;
        }
        const handleRect = (type === "row" ? this.rowHandle : this.columnHandle).getBoundingClientRect();
        this.dragState = {
            mode: type,
            startX: event.clientX,
            startY: event.clientY,
            target: -1,
            dragging: false,
            handleCenter: type === "row" ? handleRect.top + handleRect.height / 2 :
                handleRect.left + handleRect.width / 2,
            handleSize: type === "row" ? handleRect.height : handleRect.width,
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
        const cell = this.getControlCell(type);
        if (!type || !cell) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (type === "add-row" || type === "add-column" || type === "add-both") {
            if (this.suppressAddClick) {
                return;
            }
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
        if (!this.selection || this.selection.mode !== "cell" || !this.isCellInSelection(cell)) {
            this.selectFromCell(type, cell, isPrimaryModifier(event), event.shiftKey);
        }
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
        const index = mode === "row" ? info.row : info.col;
        const sameSelection = this.selection?.node === node && this.selection.mode === mode;
        if (!sameSelection) {
            this.selection = {
                node,
                table,
                mode,
                indexes: new Set(),
                cells: new Set(),
                anchor: mode === "cell" ? cell : index,
                activeCell: cell,
            };
        }
        this.selection.activeCell = cell;
        if (mode === "cell") {
            if (extend && this.selection.anchor instanceof HTMLTableCellElement) {
                const anchorInfo = grid.cellInfos.find(item => item.cell === this.selection.anchor);
                const selected = getTableCellsInRectangle(grid.cellInfos, anchorInfo, info).map(item => item.cell);
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
            this.selectedCells = grid.cellInfos.filter(info => this.selection.cells.has(info.cell)).map(info => info.cell);
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

    private getTableAddRowEdge(table: HTMLTableElement) {
        return Math.max(table.getBoundingClientRect().bottom, table.parentElement.getBoundingClientRect().bottom);
    }

    private getTableGridRect(table: HTMLTableElement) {
        const rowRects = Array.from(table.rows).map(row => row.getBoundingClientRect()).filter(rect => rect.height > 0);
        if (rowRects.length === 0) {
            return table.getBoundingClientRect();
        }
        const left = Math.min(...rowRects.map(rect => rect.left));
        const top = Math.min(...rowRects.map(rect => rect.top));
        const right = Math.max(...rowRects.map(rect => rect.right));
        const bottom = Math.max(...rowRects.map(rect => rect.bottom));
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top,
        };
    }

    private getTableGridViewportRect(table: HTMLTableElement, gridRect = this.getTableGridRect(table)) {
        return intersectRects(this.getTableViewportRect(table), gridRect);
    }

    private getColumnRect(table: HTMLTableElement, grid: ITableGrid, index: number) {
        const column = table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")[index];
        const columnRect = column?.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        if (columnRect?.width > 0 && columnRect.right > tableRect.left && columnRect.left < tableRect.right) {
            return columnRect;
        }
        const info = grid.cellInfos.find(item => item.col === index && item.colspan === 1) ||
            grid.cellInfos.find(item => item.col <= index && item.col + item.colspan > index);
        if (!info) {
            return;
        }
        const cellRect = info.cell.getBoundingClientRect();
        if (info.colspan === 1) {
            return cellRect;
        }
        const width = cellRect.width / info.colspan;
        const left = cellRect.left + width * (index - info.col);
        return {
            left,
            top: cellRect.top,
            right: left + width,
            bottom: cellRect.bottom,
            width,
            height: cellRect.height,
        };
    }

    private getEdgeHover(clientX: number, clientY: number) {
        const candidates: ITableEdgeHover[] = [];
        this.wysiwygElement.querySelectorAll<HTMLTableElement>('[data-type="NodeTable"] table').forEach(table => {
            const gridRect = this.getTableGridRect(table);
            const addColumnEdge = gridRect.right;
            const viewportRect = this.getTableGridViewportRect(table, gridRect);
            const addRowEdge = this.getTableAddRowEdge(table);
            const contentRect = (this.protyle.contentElement || this.protyle.element).getBoundingClientRect();
            const grid = buildTableGrid(table);
            const columnControlVisible = addColumnEdge <= viewportRect.right + 1 &&
                isTableResizeControlVisible(addColumnEdge, contentRect.right, TABLE_ADD_CONTROL_THICKNESS,
                    TABLE_ADD_CONTROL_GAP);
            if (columnControlVisible && addColumnEdge >= viewportRect.left &&
                addRowEdge >= contentRect.top && addRowEdge <= contentRect.bottom + 1 &&
                clientX >= addColumnEdge &&
                clientX <= addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS &&
                clientY >= addRowEdge &&
                clientY <= addRowEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS) {
                const cell = grid.cellInfos[0]?.cell;
                if (cell) {
                    candidates.push({
                        cell,
                        type: "add-both",
                        distance: -1,
                    });
                }
            }
            if (columnControlVisible &&
                clientX >= addColumnEdge &&
                clientX <= addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS &&
                clientY >= viewportRect.top && clientY <= viewportRect.bottom) {
                const cell = grid.cellInfos[0]?.cell;
                if (cell) {
                    candidates.push({
                        cell,
                        type: "add-column",
                        distance: clientX - addColumnEdge,
                    });
                }
            }
            if (addRowEdge >= contentRect.top && addRowEdge <= contentRect.bottom + 1 &&
                clientY >= addRowEdge &&
                clientY <= addRowEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS &&
                clientX >= viewportRect.left && clientX <= viewportRect.right) {
                const cell = grid.cellInfos[0]?.cell;
                if (cell) {
                    candidates.push({
                        cell,
                        type: "add-row",
                        distance: clientY - addRowEdge,
                    });
                }
            }
        });
        candidates.sort((a, b) => a.distance - b.distance);
        return candidates[0];
    }

    private appendSelectionRect(rect: ITableControlRect, viewportRect: ITableControlRect,
                                gridRect: ITableControlRect) {
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
        const radius = "var(--b3-border-radius-s)";
        const touches = (edge: number, target: number) => Math.abs(edge - target) < 1;
        const top = touches(rect.top, gridRect.top) && touches(visibleRect.top, rect.top);
        const right = touches(rect.right, gridRect.right) && touches(visibleRect.right, rect.right);
        const bottom = touches(rect.bottom, gridRect.bottom) && touches(visibleRect.bottom, rect.bottom);
        const left = touches(rect.left, gridRect.left) && touches(visibleRect.left, rect.left);
        selectionElement.style.borderRadius = [
            top && left ? radius : "0",
            top && right ? radius : "0",
            bottom && right ? radius : "0",
            bottom && left ? radius : "0",
        ].join(" ");
    }

    private positionCellHandle(rect: ITableControlRect, viewportRect: ITableControlRect) {
        const visibleRect = intersectRects(rect, viewportRect);
        if (visibleRect.width === 0 || visibleRect.height === 0) {
            return;
        }
        this.cellHandle.classList.remove("fn__none");
        this.cellHandle.style.left = `${visibleRect.right - 0.5}px`;
        this.cellHandle.style.top = `${Math.round(visibleRect.top + visibleRect.height / 2)}px`;
    }

    private renderResize() {
        const state = this.resizeState;
        if (!state) {
            return;
        }
        [this.rowHandle, this.columnHandle, this.cellHandle, this.addRowButton, this.addColumnButton,
            this.addBothButton].forEach(item => {
            item.classList.add("fn__none");
            item.classList.remove("protyle-table-control__add--active");
        });
        this.selectionElements.forEach(item => item.classList.add("fn__none"));
        const gridRect = this.getTableGridRect(state.table);
        const addColumnEdge = gridRect.right;
        const viewportRect = this.getTableGridViewportRect(state.table, gridRect);
        const addRowEdge = this.getTableAddRowEdge(state.table);
        const contentRect = (this.protyle.contentElement || this.protyle.element).getBoundingClientRect();
        const rowControlCenter = getTableResizeControlCenter(addRowEdge, contentRect.top, contentRect.bottom,
            TABLE_ADD_CONTROL_THICKNESS, TABLE_ADD_CONTROL_GAP);
        const columnControlVisible = addColumnEdge <= viewportRect.right + 1 &&
            isTableResizeControlVisible(addColumnEdge, contentRect.right, TABLE_ADD_CONTROL_THICKNESS,
                TABLE_ADD_CONTROL_GAP);
        if (state.mode === "row" || state.mode === "both") {
            this.addRowButton.classList.remove("fn__none");
            this.addRowButton.classList.add("protyle-table-control__add--active");
            this.addRowButton.style.width = `${Math.max(0, viewportRect.width)}px`;
            this.addRowButton.style.height = `${TABLE_ADD_CONTROL_THICKNESS}px`;
            this.setPosition(this.addRowButton, viewportRect.left + viewportRect.width / 2, rowControlCenter);
        }
        if ((state.mode === "column" || state.mode === "both") && columnControlVisible) {
            this.addColumnButton.classList.remove("fn__none");
            this.addColumnButton.classList.add("protyle-table-control__add--active");
            this.addColumnButton.style.width = `${TABLE_ADD_CONTROL_THICKNESS}px`;
            this.addColumnButton.style.height = `${Math.max(0, viewportRect.height)}px`;
            this.setPosition(this.addColumnButton,
                addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS / 2,
                viewportRect.top + viewportRect.height / 2);
        }
        if (state.mode === "both" && columnControlVisible) {
            this.addBothButton.classList.remove("fn__none");
            this.addBothButton.classList.add("protyle-table-control__add--active");
            this.addBothButton.style.width = `${TABLE_ADD_CONTROL_THICKNESS}px`;
            this.addBothButton.style.height = `${TABLE_ADD_CONTROL_THICKNESS}px`;
            this.setPosition(this.addBothButton,
                addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS / 2,
                rowControlCenter);
        }
        this.resizeLabel.textContent = `${state.targetRows} × ${state.targetColumns}`;
        this.resizeLabel.style.left = `${Math.round(state.pointerX + 12)}px`;
        this.resizeLabel.style.top = `${Math.round(state.pointerY + 12)}px`;
        this.resizeLabel.classList.remove("fn__none");
    }

    private clearPinnedTableFrame(action: HTMLElement) {
        ["--b3-table-frame-left", "--b3-table-frame-top", "--b3-table-frame-width",
            "--b3-table-frame-height"].forEach(name => action.style.removeProperty(name));
    }

    private renderPinnedTableFrames() {
        const actions = new Map<HTMLTableElement, HTMLElement>();
        this.wysiwygElement.querySelectorAll<HTMLTableElement>(
            '[data-type="NodeTable"][custom-pinthead="true"] table').forEach(table => {
            const action = table.nextElementSibling as HTMLElement;
            if (!action?.classList.contains("protyle-action__table")) {
                return;
            }
            const previousAction = this.pinnedTableActions.get(table);
            if (previousAction !== action) {
                if (previousAction) {
                    this.clearPinnedTableFrame(previousAction);
                } else {
                    this.pinnedTableResizeObserver.observe(table);
                }
            }
            actions.set(table, action);
            const tableRect = table.getBoundingClientRect();
            const actionRect = action.getBoundingClientRect();
            action.style.setProperty("--b3-table-frame-left",
                `${tableRect.left + table.clientLeft - actionRect.left}px`);
            action.style.setProperty("--b3-table-frame-top",
                `${tableRect.top + table.clientTop - actionRect.top}px`);
            action.style.setProperty("--b3-table-frame-width", `${table.clientWidth}px`);
            action.style.setProperty("--b3-table-frame-height", `${table.clientHeight}px`);
        });
        this.pinnedTableActions.forEach((action, table) => {
            if (actions.get(table) !== action) {
                this.clearPinnedTableFrame(action);
                if (!actions.has(table)) {
                    this.pinnedTableResizeObserver.unobserve(table);
                }
            }
        });
        this.pinnedTableActions = actions;
    }

    private render() {
        this.renderPinnedTableFrames();
        if (this.resizeState?.dragging && this.resizeState.table.isConnected) {
            this.renderResize();
            return;
        }
        const hoverCell = this.hoverCell?.isConnected ? this.hoverCell : undefined;
        const caretCell = this.caretCell?.isConnected ? this.caretCell : undefined;
        const selectionCell = this.selection?.mode !== "cell" && this.selection?.activeCell?.isConnected ?
            this.selection.activeCell : undefined;
        const cell = hoverCell || caretCell || selectionCell;
        const node = getTableNode(cell);
        const table = cell?.closest("table") as HTMLTableElement;
        const visible = !!cell && !!node && !!table && !this.protyle.disabled;
        [this.rowHandle, this.columnHandle, this.cellHandle, this.addRowButton, this.addColumnButton,
            this.addBothButton].forEach(item => {
            item.classList.add("fn__none");
            item.classList.remove("protyle-table-control__add--active");
        });
        this.resizeLabel.classList.add("fn__none");
        if (visible) {
            const gridRect = this.getTableGridRect(table);
            const addColumnEdge = gridRect.right;
            const viewportRect = this.getTableGridViewportRect(table, gridRect);
            const addRowEdge = this.getTableAddRowEdge(table);
            const contentRect = (this.protyle.contentElement || this.protyle.element).getBoundingClientRect();
            const rowControlCenter = getTableResizeControlCenter(addRowEdge, contentRect.top, contentRect.bottom,
                TABLE_ADD_CONTROL_THICKNESS, TABLE_ADD_CONTROL_GAP);
            const columnControlVisible = addColumnEdge <= viewportRect.right + 1 &&
                isTableResizeControlVisible(addColumnEdge, contentRect.right, TABLE_ADD_CONTROL_THICKNESS,
                    TABLE_ADD_CONTROL_GAP);
            const grid = this.selection?.table === table && this.selectionGrid ?
                this.selectionGrid : buildTableGrid(table);
            const cellInfo = grid.cellInfos.find(item => item.cell === cell);
            const rowIndex = cellInfo?.row;
            const rowRect = typeof rowIndex === "number" ? table.rows[rowIndex]?.getBoundingClientRect() : undefined;
            const visibleRowRect = rowRect ? intersectRects(rowRect, viewportRect) : undefined;
            const columnIndex = cellInfo?.col;
            const columnRect = typeof columnIndex === "number" ?
                this.getColumnRect(table, grid, columnIndex) : undefined;
            const visibleColumnRect = columnRect ? intersectRects(columnRect, viewportRect) : undefined;
            const merged = grid.cellInfos.some(info => info.rowspan > 1 || info.colspan > 1);
            this.rowHandle.classList.toggle("protyle-table-control__handle--drag-disabled", merged ||
                (this.selection?.table === table && this.selection.mode === "row" &&
                    this.selection.indexes.size > 1 && this.selection.indexes.has(0)));
            this.columnHandle.classList.toggle("protyle-table-control__handle--drag-disabled", merged);
            if (hoverCell && this.hoverType === "cell" && cellInfo?.col === 0 &&
                visibleRowRect?.width > 0 && visibleRowRect.height > 0) {
                this.rowHandle.classList.remove("fn__none");
                this.rowHandle.style.width = `${TABLE_HANDLE_THICKNESS}px`;
                this.rowHandle.style.height = `${visibleRowRect.height}px`;
                this.setPosition(this.rowHandle, viewportRect.left,
                    visibleRowRect.top + visibleRowRect.height / 2);
            }
            if (hoverCell && this.hoverType === "cell" && cellInfo?.row === 0 &&
                visibleColumnRect?.width > 0 && viewportRect.height > 0) {
                this.columnHandle.classList.remove("fn__none");
                this.columnHandle.style.width = `${visibleColumnRect.width}px`;
                this.columnHandle.style.height = `${TABLE_HANDLE_THICKNESS}px`;
                this.setPosition(this.columnHandle, visibleColumnRect.left + visibleColumnRect.width / 2,
                    viewportRect.top);
            }
            if ((this.hoverType === "add-row" || this.hoverType === "add-both") && viewportRect.width > 0 &&
                addRowEdge >= contentRect.top && addRowEdge <= contentRect.bottom + 1) {
                this.addRowButton.classList.remove("fn__none");
                this.addRowButton.style.width = `${viewportRect.width}px`;
                this.addRowButton.style.height = `${TABLE_ADD_CONTROL_THICKNESS}px`;
                this.setPosition(this.addRowButton, viewportRect.left + viewportRect.width / 2, rowControlCenter);
            }
            if ((this.hoverType === "add-column" || this.hoverType === "add-both") && viewportRect.height > 0 &&
                columnControlVisible &&
                addColumnEdge >= viewportRect.left) {
                this.addColumnButton.classList.remove("fn__none");
                this.addColumnButton.style.width = `${TABLE_ADD_CONTROL_THICKNESS}px`;
                this.addColumnButton.style.height = `${viewportRect.height}px`;
                this.setPosition(this.addColumnButton,
                    addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS / 2,
                    viewportRect.top + viewportRect.height / 2);
            }
            if (this.hoverType === "add-both" && columnControlVisible &&
                addRowEdge >= contentRect.top && addRowEdge <= contentRect.bottom + 1) {
                this.addBothButton.classList.remove("fn__none");
                this.addBothButton.style.width = `${TABLE_ADD_CONTROL_THICKNESS}px`;
                this.addBothButton.style.height = `${TABLE_ADD_CONTROL_THICKNESS}px`;
                this.setPosition(this.addBothButton,
                    addColumnEdge + TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS / 2,
                    rowControlCenter);
            }
        }
        if (!this.dragState && !this.selection && caretCell) {
            const table = caretCell.closest("table") as HTMLTableElement;
            const viewportRect = table ? this.getTableGridViewportRect(table) : undefined;
            if (viewportRect) {
                this.positionCellHandle(caretCell.getBoundingClientRect(), viewportRect);
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
        const selectionGridRect = this.getTableGridRect(this.selection.table);
        const selectionViewportRect = intersectRects(
            this.getTableViewportRect(this.selection.table), selectionGridRect);
        if (this.selection.mode === "row") {
            const rows = Array.from(this.selection.table.rows);
            getIndexGroups(this.selection.indexes).forEach(group => {
                const startRect = rows[group.start]?.getBoundingClientRect();
                const endRect = rows[group.end]?.getBoundingClientRect();
                if (startRect && endRect) {
                    this.appendSelectionRect({
                        left: selectionGridRect.left,
                        top: startRect.top,
                        right: selectionGridRect.right,
                        bottom: endRect.bottom,
                        width: selectionGridRect.width,
                        height: endRect.bottom - startRect.top,
                    }, selectionViewportRect, selectionGridRect);
                }
            });
        } else if (this.selection.mode === "column") {
            const grid = this.selectionGrid || buildTableGrid(this.selection.table);
            getIndexGroups(this.selection.indexes).forEach(group => {
                const startRect = this.getColumnRect(this.selection.table, grid, group.start);
                const endRect = this.getColumnRect(this.selection.table, grid, group.end);
                if (startRect && endRect) {
                    this.appendSelectionRect({
                        left: startRect.left,
                        top: selectionGridRect.top,
                        right: endRect.right,
                        bottom: selectionGridRect.bottom,
                        width: endRect.right - startRect.left,
                        height: selectionGridRect.height,
                    }, selectionViewportRect, selectionGridRect);
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
                const rect = {left, top, right, bottom, width: right - left, height: bottom - top};
                this.appendSelectionRect(rect, selectionViewportRect, selectionGridRect);
                if (!this.dragState) {
                    this.positionCellHandle(rect, selectionViewportRect);
                }
            }
        } else {
            this.getSelectedCells().forEach(item => {
                this.appendSelectionRect(item.getBoundingClientRect(), selectionViewportRect, selectionGridRect);
            });
            if (!this.dragState && this.selection.mode === "cell") {
                this.positionCellHandle(this.selection.activeCell.getBoundingClientRect(), selectionViewportRect);
            }
        }
    }

    private openMenu(x: number, y: number) {
        if (!this.selection) {
            return;
        }
        const menu = window.siyuan.menus.menu;
        menu.remove();
        const merged = buildTableGrid(this.selection.table).cellInfos.some(info => info.rowspan > 1 || info.colspan > 1);
        const mergedSelection = this.selection.mode !== "cell" && merged;
        const rectangle = this.selection.mode !== "cell" || this.isRectangle();
        menu.append(new MenuItem({
            icon: "iconCopy",
            label: window.siyuan.languages.copy,
            disabled: !rectangle,
            accelerator: rectangle ? undefined : window.siyuan.languages.tableRectangleSelectionRequired,
            click: () => this.execClipboardCommand("copy"),
        }).element);
        if (this.selection.mode === "cell" && rectangle && this.getSelectedCells().length > 1) {
            menu.append(new MenuItem({
                id: "copyRichText",
                label: window.siyuan.languages.copyRichText,
                accelerator: window.siyuan.config.keymap.editor.general.copyRichText.custom,
                click: () => this.copySelectionAsRichText(),
            }).element);
            menu.append(new MenuItem({
                id: "copyPlainText",
                label: window.siyuan.languages.copyPlainText,
                click: () => {
                    const content = this.getSelectionClipboardContent();
                    if (content) {
                        copyPlainText(content.text);
                    }
                },
            }).element);
        }
        menu.append(new MenuItem({
            icon: "iconCut",
            label: window.siyuan.languages.cut,
            disabled: this.protyle.disabled || !rectangle || mergedSelection,
            accelerator: !rectangle ? window.siyuan.languages.tableRectangleSelectionRequired : undefined,
            action: mergedSelection ? "iconInfo" : undefined,
            actionLabel: mergedSelection ? window.siyuan.languages.splitMergedCellTip : undefined,
            click: () => this.execClipboardCommand("cut"),
        }).element);
        if (!this.protyle.disabled && this.selection.mode === "cell") {
            menu.append(new MenuItem({
                icon: "iconPaste",
                label: window.siyuan.languages.paste,
                click: () => this.paste(),
            }).element);
            menu.append(new MenuItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages.clear,
                click: () => this.clearCells(),
            }).element);
        }
        if (!this.protyle.disabled) {
            menu.append(new MenuItem({type: "separator"}).element);
            this.appendInsertMenus();
            if (this.selection.mode !== "cell") {
                menu.append(new MenuItem({
                    icon: "iconCopy",
                    label: window.siyuan.languages.duplicate,
                    disabled: merged,
                    action: merged ? "iconInfo" : undefined,
                    actionLabel: merged ? window.siyuan.languages.splitMergedCellTip : undefined,
                    click: () => this.duplicateRowsOrColumns(),
                }).element);
                if (this.selection.indexes.size === 1 && this.selection.indexes.has(0)) {
                    const headerType = this.selection.mode === "row" ? "row" : "column";
                    menu.append(new MenuItem({
                        id: headerType === "row" ? "tableHeaderRow" : "tableHeaderColumn",
                        label: headerType === "row" ? window.siyuan.languages.tableHeaderRow :
                            window.siyuan.languages.tableHeaderColumn,
                        checked: isTableHeaderEnabled(this.selection.node, headerType),
                        click: () => toggleTableHeader(this.protyle, this.selection.node, headerType),
                    }).element);
                }
                menu.append(new MenuItem({type: "separator"}).element);
            }
            menu.append(new MenuItem({
                icon: "iconFont",
                label: window.siyuan.languages.fontStyle,
                submenu: getTableCellTextStyleMenus(this.protyle, this.getSelectedCells(), () => this.scheduleRender()),
            }).element);
            menu.append(new MenuItem({
                icon: "iconTheme",
                label: window.siyuan.languages.colorPrimary,
                submenu: this.getBackgroundMenus(),
            }).element);
            if (this.selection.mode === "cell") {
                this.appendCellMenus(rectangle);
            } else {
                this.appendAlignmentMenu();
                menu.append(new MenuItem({type: "separator"}).element);
                menu.append(new MenuItem({
                    icon: "iconClear",
                    label: window.siyuan.languages.clear,
                    click: () => this.clearCells(),
                }).element);
                menu.append(new MenuItem({
                    icon: "iconTrashcan",
                    label: this.selection.mode === "row" ? window.siyuan.languages["delete-row"] :
                        window.siyuan.languages["delete-column"],
                    disabled: merged,
                    action: merged ? "iconInfo" : undefined,
                    actionLabel: merged ? window.siyuan.languages.splitMergedCellTip : undefined,
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
            const canInsertAbove = this.canInsertAtBoundary(grid, "row", above);
            const canInsertBelow = this.canInsertAtBoundary(grid, "row", below);
            this.appendInsertMenu("iconBefore", window.siyuan.languages.insertRowBefore, canInsertAbove, count => {
                this.insertRowAt(selection.node, selection.table, above, count);
            });
            this.appendInsertMenu("iconAfter", window.siyuan.languages.insertRowAfter, canInsertBelow, count => {
                this.insertRowAt(selection.node, selection.table, below, count);
            });
        } else if (this.selection.mode === "column") {
            const left = indexes[0];
            const right = indexes[indexes.length - 1] + 1;
            const canInsertLeft = this.canInsertAtBoundary(grid, "column", left);
            const canInsertRight = this.canInsertAtBoundary(grid, "column", right);
            this.appendInsertMenu("iconInsertLeft", window.siyuan.languages.insertColumnLeft1, canInsertLeft,
                count => {
                    this.insertColumnAt(selection.node, selection.table, left, count);
                });
            this.appendInsertMenu("iconInsertRight", window.siyuan.languages.insertColumnRight1, canInsertRight,
                count => {
                    this.insertColumnAt(selection.node, selection.table, right, count);
                });
        }
    }

    private appendInsertMenu(icon: string, label: string, canInsert: boolean, insert: (count: number) => void) {
        const inputHTML = `<span class="fn__space"></span><input type="number" step="1" min="1" value="1" placeholder="${window.siyuan.languages.enterKey}" class="b3-text-field b3-text-field--size"><span class="fn__space"></span>`;
        window.siyuan.menus.menu.append(new MenuItem({
            icon,
            label: `<div class="fn__flex" style="align-items: center;">${label.replace("${x}", inputHTML)}</div>`,
            disabled: !canInsert,
            action: canInsert ? undefined : "iconInfo",
            actionLabel: canInsert ? undefined : window.siyuan.languages.splitMergedCellTip,
            bind: element => {
                const inputElement = element.querySelector("input") as HTMLInputElement;
                const runInsert = () => {
                    insert(Math.max(1, parseInt(inputElement.value) || 1));
                    window.siyuan.menus.menu.remove();
                };
                element.addEventListener("click", () => {
                    if (document.activeElement !== inputElement) {
                        runInsert();
                    }
                });
                inputElement.addEventListener("keydown", event => {
                    if (!event.isComposing && event.key === "Enter") {
                        runInsert();
                    }
                });
            },
        }).element);
    }

    private canInsertAtBoundary(grid: ITableGrid, mode: "row" | "column", index: number) {
        return !grid.cellInfos.some(info => {
            const start = mode === "row" ? info.row : info.col;
            const span = mode === "row" ? info.rowspan : info.colspan;
            return start < index && start + span > index;
        });
    }

    private getTableHTMLWithCaret(node: HTMLElement) {
        const marker = document.createElement("wbr");
        getEditorRange(node).insertNode(marker);
        const html = node.outerHTML;
        marker.remove();
        return html;
    }

    private insertRowAt(node: HTMLElement, table: HTMLTableElement, index: number, count = 1) {
        const grid = buildTableGrid(table);
        if (!this.canInsertAtBoundary(grid, "row", index)) {
            return;
        }
        count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
        const oldHTML = this.getTableHTMLWithCaret(node);
        const headRowCount = table.tHead?.rows.length || 0;
        const tag = index < headRowCount || index === 0 ? "th" : "td";
        const sourceRow = Math.min(index, Math.max(0, grid.rowCount - 1));
        const rows: HTMLTableRowElement[] = [];
        for (let rowIndex = 0; rowIndex < count; rowIndex++) {
            const row = document.createElement("tr");
            for (let column = 0; column < grid.columnCount; column++) {
                const cell = document.createElement(tag);
                const align = grid.grid[sourceRow]?.[column]?.getAttribute("align");
                if (align) {
                    cell.setAttribute("align", align);
                }
                row.append(cell);
            }
            rows.push(row);
        }
        const reference = table.rows[index];
        if (reference) {
            reference.before(...rows);
        } else {
            (table.tBodies[0] || table.createTBody()).append(...rows);
        }
        if (index === 0) {
            this.normalizeTableSections(table);
        }
        if (rows[0]?.cells[0]) {
            const range = document.createRange();
            range.selectNodeContents(rows[0].cells[0]);
            range.collapse(true);
            focusByRange(range);
        }
        updateTransaction(this.protyle, node, oldHTML);
        this.clear();
    }

    private insertColumnAt(node: HTMLElement, table: HTMLTableElement, index: number, count = 1) {
        const grid = buildTableGrid(table);
        if (!this.canInsertAtBoundary(grid, "column", index)) {
            return;
        }
        count = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
        const oldHTML = this.getTableHTMLWithCaret(node);
        let focusCell: HTMLTableCellElement;
        Array.from(table.rows).forEach(row => {
            const reference = row.cells[index];
            for (let columnIndex = 0; columnIndex < count; columnIndex++) {
                const cell = document.createElement(row.parentElement.tagName === "THEAD" ? "th" : "td");
                if (reference) {
                    reference.before(cell);
                } else {
                    row.append(cell);
                }
                if (!focusCell) {
                    focusCell = cell;
                }
            }
        });
        const colgroup = table.querySelector(":scope > colgroup");
        if (colgroup) {
            const reference = colgroup.children[index];
            for (let columnIndex = 0; columnIndex < count; columnIndex++) {
                const column = document.createElement("col");
                column.style.minWidth = "60px";
                if (reference) {
                    reference.before(column);
                } else {
                    colgroup.append(column);
                }
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

    private copySelectionAsRichText() {
        const cells = this.getSelectedCells();
        const first = cells[0];
        const last = cells[cells.length - 1];
        if (!first || !last) {
            return;
        }
        const range = document.createRange();
        range.setStart(first, 0);
        range.setEnd(last, last.childNodes.length);
        focusByRange(range);
        this.bypassClipboardEvent = true;
        try {
            this.protyle.wysiwyg.copyRichText();
        } finally {
            this.bypassClipboardEvent = false;
            getSelection()?.removeAllRanges();
        }
    }

    private async paste() {
        if (!this.selection?.activeCell.isConnected) {
            return;
        }
        const cell = this.getSelectedCells()[0] || this.selection.activeCell;
        const range = getEditorRange(cell);
        range.selectNodeContents(cell);
        range.collapse(true);
        focusByRange(range);
        if (document.queryCommandSupported("paste")) {
            document.execCommand("paste");
        } else {
            try {
                const text = await readClipboard();
                paste(this.protyle, Object.assign(text, {target: cell}));
            } catch (error) {
                console.log(error);
            }
        }
    }

    private appendCellMenus(rectangle: boolean) {
        const cells = this.getSelectedCells();
        this.appendAlignmentMenu();
        const cellSelection = getTableCellSelectionIndexes(this.selection.table, cells);
        if (cellSelection.rowIndexes.length > 0 || cellSelection.columnIndexes.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
        if (cellSelection.rowIndexes.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages["delete-row"],
                disabled: cellSelection.merged,
                action: cellSelection.merged ? "iconInfo" : undefined,
                actionLabel: cellSelection.merged ? window.siyuan.languages.splitMergedCellTip : undefined,
                click: () => {
                    if (deleteTableRows(this.protyle, this.selection.node, cellSelection.rowIndexes)) {
                        this.clear();
                    }
                },
            }).element);
        }
        if (cellSelection.columnIndexes.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages["delete-column"],
                disabled: cellSelection.merged,
                action: cellSelection.merged ? "iconInfo" : undefined,
                actionLabel: cellSelection.merged ? window.siyuan.languages.splitMergedCellTip : undefined,
                click: () => {
                    if (deleteTableColumns(this.protyle, this.selection.node, cellSelection.columnIndexes)) {
                        this.clear();
                    }
                },
            }).element);
        }
        const mergedCell = cells.length === 1 && (cells[0].rowSpan > 1 || cells[0].colSpan > 1);
        if (mergedCell || cells.length > 1) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                icon: mergedCell ? "iconTableCellsSplit" : "iconTableCellsMerge",
                label: mergedCell ? window.siyuan.languages.cancelMerged : window.siyuan.languages.mergeCell,
                disabled: !mergedCell && (!rectangle || !this.isSelectionInOneSection()),
                accelerator: !mergedCell && !rectangle ? window.siyuan.languages.tableRectangleSelectionRequired : undefined,
                click: () => mergedCell ? this.splitCell(cells[0]) : this.mergeCells(),
            }).element);
        }
    }

    private appendAlignmentMenu() {
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            id: "alignment",
            icon: "iconAlignSettings",
            label: window.siyuan.languages.alignment,
            type: "submenu",
            submenu: getTableCellAlignmentMenus(this.getSelectedCells(),
                (property, value) => this.setCellStyle(property, value)),
        }).element);
    }

    private isSelectionInOneSection() {
        const sections = new Set(this.getSelectedCells().map(cell => cell.parentElement.parentElement.tagName));
        return sections.size === 1;
    }

    private getBackgroundMenus(): IMenu[] {
        return getTableCellBackgroundMenus(this.getSelectedCells(), color => this.setCellStyle("background-color", color));
    }

    private setCellStyle(property: string, value: string) {
        if (!this.selection) {
            return;
        }
        setTableCellStyle(this.protyle, this.selection.node, this.getSelectedCells(), property, value);
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
        if (selection.mode === "row") {
            deleteTableRows(this.protyle, selection.node, Array.from(selection.indexes));
        } else {
            deleteTableColumns(this.protyle, selection.node, Array.from(selection.indexes));
        }
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

    private isTableCellEmpty(cell: HTMLTableCellElement) {
        return isTableCellContentEmpty(cell.textContent || "", !!cell.querySelector(TABLE_NON_TEXT_CONTENT_SELECTOR));
    }

    private getResizeLimits(grid: ITableGrid) {
        let minRows = 1;
        let minColumns = 1;
        const invalidRowCounts = new Set<number>();
        const invalidColumnCounts = new Set<number>();
        grid.cellInfos.forEach(info => {
            if (!this.isTableCellEmpty(info.cell)) {
                minRows = Math.max(minRows, info.row + info.rowspan);
                minColumns = Math.max(minColumns, info.col + info.colspan);
            }
            for (let count = info.row + 1; count < info.row + info.rowspan; count++) {
                invalidRowCounts.add(count);
            }
            for (let count = info.col + 1; count < info.col + info.colspan; count++) {
                invalidColumnCounts.add(count);
            }
        });
        return {minRows, minColumns, invalidRowCounts, invalidColumnCounts};
    }

    private startResize(event: PointerEvent, type: TableAddControlType) {
        const node = getTableNode(this.hoverCell);
        const table = node?.querySelector("table") as HTMLTableElement;
        if (!node || !table) {
            return;
        }
        this.cancelResize();
        const grid = buildTableGrid(table);
        if (grid.rowCount === 0 || grid.columnCount === 0) {
            return;
        }
        const limits = this.getResizeLimits(grid);
        const rowSizes = Array.from(table.rows).map(row => row.getBoundingClientRect().height);
        const columnSizes = Array.from({length: grid.columnCount}, (_, index) =>
            this.getColumnRect(table, grid, index)?.width || TABLE_DEFAULT_COLUMN_WIDTH);
        const positiveRowSizes = rowSizes.filter(size => size > 0);
        const state: IResizeState = {
            mode: type === "add-row" ? "row" : type === "add-column" ? "column" : "both",
            node,
            table,
            tableHTML: table.innerHTML,
            oldHTML: this.getTableHTMLWithCaret(node),
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            pointerX: event.clientX,
            pointerY: event.clientY,
            startRows: grid.rowCount,
            startColumns: grid.columnCount,
            targetRows: grid.rowCount,
            targetColumns: grid.columnCount,
            minRows: limits.minRows,
            minColumns: limits.minColumns,
            invalidRowCounts: limits.invalidRowCounts,
            invalidColumnCounts: limits.invalidColumnCounts,
            rowSizes,
            columnSizes,
            addedRowSize: positiveRowSizes.length > 0 ? Math.min(...positiveRowSizes) :
                TABLE_ADD_CONTROL_THICKNESS,
            addedColumnSize: TABLE_DEFAULT_COLUMN_WIDTH,
            dragging: false,
        };
        this.resizeState = state;
        this.selection = undefined;
        this.selectionGrid = undefined;
        this.selectedCells = [];
        this.selectionElements.forEach(item => item.classList.add("fn__none"));
        getSelection()?.removeAllRanges();
        const move = (moveEvent: PointerEvent) => this.handleResizeMove(moveEvent);
        const up = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== state.pointerId) {
                return;
            }
            state.cleanup?.();
            this.finishResize(upEvent);
        };
        const cancel = (cancelEvent: PointerEvent) => {
            if (cancelEvent.pointerId !== state.pointerId) {
                return;
            }
            this.cancelResize();
        };
        state.cleanup = () => {
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", up);
            document.removeEventListener("pointercancel", cancel);
        };
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
        document.addEventListener("pointercancel", cancel);
    }

    private handleResizeMove(event: PointerEvent) {
        const state = this.resizeState;
        if (!state || event.pointerId !== state.pointerId) {
            return;
        }
        const deltaX = event.clientX - state.startX;
        const deltaY = event.clientY - state.startY;
        if (!state.dragging && Math.hypot(deltaX, deltaY) < TABLE_RESIZE_DRAG_THRESHOLD) {
            return;
        }
        event.preventDefault();
        state.dragging = true;
        state.pointerX = event.clientX;
        state.pointerY = event.clientY;
        let targetRows = state.startRows;
        let targetColumns = state.startColumns;
        if (state.mode === "row" || state.mode === "both") {
            const requestedRows = getTableResizeCount(state.startRows, deltaY, state.addedRowSize, state.rowSizes);
            targetRows = constrainTableResizeCount(requestedRows, state.startRows, state.minRows,
                state.invalidRowCounts);
        }
        if (state.mode === "column" || state.mode === "both") {
            const requestedColumns = getTableResizeCount(state.startColumns, deltaX, state.addedColumnSize,
                state.columnSizes);
            targetColumns = constrainTableResizeCount(requestedColumns, state.startColumns, state.minColumns,
                state.invalidColumnCounts);
        }
        if (targetRows !== state.targetRows || targetColumns !== state.targetColumns) {
            state.table.innerHTML = state.tableHTML;
            this.resizeTable(state.table, targetRows, targetColumns);
            state.targetRows = targetRows;
            state.targetColumns = targetColumns;
            this.hoverCell = state.table.querySelector("th, td");
        }
        this.scheduleRender();
    }

    private finishResize(event: PointerEvent) {
        const state = this.resizeState;
        if (!state) {
            return;
        }
        state.cleanup?.();
        if (!state.dragging) {
            this.resizeState = undefined;
            this.scheduleRender();
            return;
        }
        const cell = this.getResizeFocusCell(state);
        if (cell) {
            const range = document.createRange();
            range.selectNodeContents(cell);
            range.collapse(true);
            focusByRange(range);
            this.hoverCell = cell;
        }
        updateTransaction(this.protyle, state.node, state.oldHTML);
        this.suppressAddClick = true;
        setTimeout(() => {
            this.suppressAddClick = false;
        });
        this.resizeState = undefined;
        this.resizeLabel.classList.add("fn__none");
        this.scheduleRender();
        event.preventDefault();
    }

    private cancelResize() {
        const state = this.resizeState;
        if (!state) {
            return;
        }
        state.cleanup?.();
        if (state.dragging && state.table.isConnected) {
            state.table.innerHTML = state.tableHTML;
            this.hoverCell = state.table.querySelector("th, td");
        }
        this.resizeState = undefined;
        this.resizeLabel.classList.add("fn__none");
        this.scheduleRender();
    }

    private resizeTable(table: HTMLTableElement, targetRows: number, targetColumns: number) {
        let grid = buildTableGrid(table);
        if (targetRows < grid.rowCount) {
            Array.from(table.rows).slice(targetRows).forEach(row => row.remove());
        }
        grid = buildTableGrid(table);
        if (targetColumns < grid.columnCount) {
            const cells = new Set(grid.cellInfos.filter(info => info.col >= targetColumns).map(info => info.cell));
            Array.from(table.rows).forEach(row => {
                Array.from(row.cells).forEach((cell, index) => {
                    if (cells.has(cell) || (cell.classList.contains("fn__none") && index >= targetColumns)) {
                        cell.remove();
                    }
                });
            });
            Array.from(table.querySelectorAll(":scope > colgroup > col")).slice(targetColumns)
                .forEach(column => column.remove());
        }
        grid = buildTableGrid(table);
        if (targetColumns > grid.columnCount) {
            const count = targetColumns - grid.columnCount;
            Array.from(table.rows).forEach(row => {
                const tag = row.parentElement.tagName === "THEAD" ? "th" : "td";
                for (let index = 0; index < count; index++) {
                    row.append(document.createElement(tag));
                }
            });
            const colgroup = table.querySelector(":scope > colgroup");
            if (colgroup) {
                for (let index = 0; index < count; index++) {
                    const column = document.createElement("col");
                    column.style.minWidth = `${TABLE_DEFAULT_COLUMN_WIDTH}px`;
                    colgroup.append(column);
                }
            }
        }
        grid = buildTableGrid(table);
        if (targetRows > grid.rowCount) {
            const body = table.tBodies[0] || table.createTBody();
            const sourceRow = Math.max(0, grid.rowCount - 1);
            const rows: HTMLTableRowElement[] = [];
            for (let rowIndex = grid.rowCount; rowIndex < targetRows; rowIndex++) {
                const row = document.createElement("tr");
                for (let columnIndex = 0; columnIndex < targetColumns; columnIndex++) {
                    const cell = document.createElement("td");
                    const align = grid.grid[sourceRow]?.[columnIndex]?.getAttribute("align");
                    if (align) {
                        cell.setAttribute("align", align);
                    }
                    row.append(cell);
                }
                rows.push(row);
            }
            body.append(...rows);
        }
    }

    private getResizeFocusCell(state: IResizeState) {
        const grid = buildTableGrid(state.table);
        if (state.mode === "row") {
            const row = state.targetRows > state.startRows ? state.startRows : state.targetRows - 1;
            return grid.grid[row]?.find(cell => cell);
        }
        if (state.mode === "column") {
            const column = state.targetColumns > state.startColumns ? state.startColumns :
                state.targetColumns - 1;
            return grid.grid[0]?.[column];
        }
        return grid.grid[state.targetRows - 1]?.[state.targetColumns - 1];
    }

    private addAtEnd(type: TableAddControlType) {
        const node = getTableNode(this.hoverCell);
        if (!node) {
            return;
        }
        const table = node.querySelector("table") as HTMLTableElement;
        const grid = buildTableGrid(table);
        if (type === "add-row") {
            this.insertRowAt(node, table, grid.rowCount);
        } else if (type === "add-column") {
            this.insertColumnAt(node, table, grid.columnCount);
        } else {
            const oldHTML = this.getTableHTMLWithCaret(node);
            this.resizeTable(table, grid.rowCount + 1, grid.columnCount + 1);
            const updatedGrid = buildTableGrid(table);
            const cell = updatedGrid.grid[updatedGrid.rowCount - 1]?.[updatedGrid.columnCount - 1];
            if (cell) {
                const range = document.createRange();
                range.selectNodeContents(cell);
                range.collapse(true);
                focusByRange(range);
            }
            updateTransaction(this.protyle, node, oldHTML);
            this.clear();
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
        const preview = this.updateDragPreview(event);
        if (!preview) {
            return;
        }
        const {position, viewportRect, edge} = preview;
        const grid = this.selectionGrid || buildTableGrid(this.selection.table);
        if (edge) {
            const target = edge === "start" ? 0 :
                (this.dragState.mode === "row" ? grid.rowCount : grid.columnCount);
            if (!this.getMoveTarget(target)) {
                this.dragState.target = -1;
                this.dropIndicator.classList.add("fn__none");
                return;
            }
            this.dragState.target = target;
            this.dropIndicator.classList.remove("fn__none");
            if (this.dragState.mode === "row") {
                this.dropIndicator.classList.add("protyle-table-control__drop--row");
                this.dropIndicator.classList.remove("protyle-table-control__drop--column");
                this.dropIndicator.style.left = `${viewportRect.left}px`;
                this.dropIndicator.style.top = `${edge === "start" ? viewportRect.top : viewportRect.bottom}px`;
                this.dropIndicator.style.width = `${viewportRect.width}px`;
                this.dropIndicator.style.height = "2px";
            } else {
                this.dropIndicator.classList.add("protyle-table-control__drop--column");
                this.dropIndicator.classList.remove("protyle-table-control__drop--row");
                this.dropIndicator.style.left = `${edge === "start" ? viewportRect.left : viewportRect.right}px`;
                this.dropIndicator.style.top = `${viewportRect.top}px`;
                this.dropIndicator.style.width = "2px";
                this.dropIndicator.style.height = `${viewportRect.height}px`;
            }
            return;
        }
        let cell: HTMLTableCellElement;
        if (this.dragState.mode === "row") {
            const rowIndex = Array.from(this.selection.table.rows).findIndex(row => {
                const rect = intersectRects(row.getBoundingClientRect(), viewportRect);
                return rect.height > 0 && position >= rect.top && position <= rect.bottom;
            });
            cell = grid.grid[rowIndex]?.find(item => item);
        } else {
            cell = grid.grid[0]?.find(item => {
                if (!item) {
                    return false;
                }
                const rect = intersectRects(item.getBoundingClientRect(), viewportRect);
                return rect.width > 0 && position >= rect.left && position <= rect.right;
            });
        }
        if (!cell) {
            this.dragState.target = -1;
            this.dropIndicator.classList.add("fn__none");
            return;
        }
        const info = this.dragState.cellInfos.get(cell);
        if (!info) {
            return;
        }
        const rect = this.dragState.mode === "row" ? cell.parentElement.getBoundingClientRect() : cell.getBoundingClientRect();
        const visibleRect = intersectRects(rect, viewportRect);
        if (visibleRect.width === 0 || visibleRect.height === 0) {
            this.dragState.target = -1;
            this.dropIndicator.classList.add("fn__none");
            return;
        }
        const after = this.dragState.mode === "row" ? position > rect.top + rect.height / 2 :
            position > rect.left + rect.width / 2;
        const target = (this.dragState.mode === "row" ? info.row : info.col) + (after ? 1 : 0);
        if (!this.getMoveTarget(target)) {
            this.dragState.target = -1;
            this.dropIndicator.classList.add("fn__none");
            return;
        }
        this.dragState.target = target;
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

    private updateDragPreview(event: PointerEvent) {
        const state = this.dragState;
        if (!state || !this.selection) {
            return;
        }
        const viewportRect = this.getTableGridViewportRect(this.selection.table);
        const start = state.mode === "column" ? viewportRect.left : viewportRect.top;
        const end = state.mode === "column" ? viewportRect.right : viewportRect.bottom;
        const minCenter = start + state.handleSize / 2;
        const maxCenter = end - state.handleSize / 2;
        const pointerOffset = state.mode === "column" ? event.clientX - state.startX : event.clientY - state.startY;
        const targetCenter = state.handleCenter + pointerOffset;
        const center = minCenter <= maxCenter ? Math.min(Math.max(targetCenter, minCenter), maxCenter) :
            (start + end) / 2;
        const edge = getTableDragEdge(targetCenter, minCenter, maxCenter);
        const offset = Math.round(center - state.handleCenter);
        const offsetX = state.mode === "column" ? offset : 0;
        const offsetY = state.mode === "row" ? offset : 0;
        const translate = `${offsetX}px ${offsetY}px`;
        const handle = state.mode === "row" ? this.rowHandle : this.columnHandle;
        handle.style.translate = translate;
        this.cellHandle.classList.add("fn__none");
        return {
            position: state.handleCenter + offset,
            viewportRect,
            edge,
        };
    }

    private clearDragPreview() {
        this.rowHandle.style.removeProperty("translate");
        this.columnHandle.style.removeProperty("translate");
    }

    private getMoveTarget(target: number) {
        if (!this.selection || this.selection.mode === "cell") {
            return;
        }
        const selected = Array.from(this.selection.indexes).sort((a, b) => a - b);
        if (this.selection.mode === "row" && selected.length > 1 && (selected.includes(0) || target === 0)) {
            return;
        }
        const adjustedTarget = target - selected.filter(index => index < target).length;
        const itemCount = this.selection.mode === "row" ? this.selection.table.rows.length :
            this.selection.table.rows[0]?.cells.length || 0;
        const indexes = Array.from({length: itemCount}, (_, index) => index);
        const moving = indexes.filter(index => selected.includes(index));
        const remaining = indexes.filter(index => !selected.includes(index));
        remaining.splice(Math.max(0, adjustedTarget), 0, ...moving);
        if (remaining.every((index, position) => index === position)) {
            return;
        }
        return {selected, adjustedTarget};
    }

    private handleDragEnd(event: PointerEvent) {
        if (!this.dragState) {
            return;
        }
        const state = this.dragState;
        this.clearDragPreview();
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
        const moveTarget = this.getMoveTarget(target);
        if (!moveTarget || !this.selection) {
            return;
        }
        const {selected, adjustedTarget} = moveTarget;
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

    private getSelectionClipboardContent() {
        if (!this.selection) {
            return;
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
            return;
        }
        const container = document.createElement("div");
        container.innerHTML = html;
        const rows = Array.from(container.querySelectorAll("tr"));
        const text = rows.map(row => Array.from(row.querySelectorAll("th, td")).filter(cell =>
            !cell.classList.contains("fn__none")).map(cell => getCellText(cell as HTMLTableCellElement)).join("\t")).join("\n");
        const textSiyuan = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeTable" class="table"><div contenteditable="true" spellcheck="false">${html}<div class="protyle-action__table"><div class="table__resize"></div><div class="table__select"></div></div></div><div class="protyle-attr" contenteditable="false">\u200b</div></div>`;
        const textHTML = `<!--data-siyuan='${encodeBase64(textSiyuan)}'-->${removeZWJ(textSiyuan)}`;
        return {text, textSiyuan, textHTML};
    }

    private writeClipboard(event: ClipboardEvent) {
        if (!event.clipboardData) {
            return false;
        }
        const content = this.getSelectionClipboardContent();
        if (!content) {
            return false;
        }
        event.clipboardData.setData("text/plain", content.text);
        event.clipboardData.setData("text/siyuan", content.textSiyuan);
        event.clipboardData.setData("text/html", content.textHTML);
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
