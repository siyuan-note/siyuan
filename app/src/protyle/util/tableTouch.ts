import type {ITableGrid} from "./table";
import {TABLE_VIRTUAL_ROWS} from "./tableVirtualizationDOM";
import {renderMultiSelectToolbar, updateMultiSelectToolbar} from "../../mobile/util/multiSelectToolbar";
import {TABLE_ADD_CONTROL_GAP, TABLE_ADD_CONTROL_THICKNESS} from "./tableResize";
import {Constants} from "../../constants";
import {getTableRowBoundary} from "./tableRowHeight";

type SelectionMode = "cell" | "row" | "column";
const TABLE_TOUCH_INTERACTIVE_SELECTOR = "a, [data-type~='a'], [data-type~='block-ref'], [data-type~='file-annotation-ref'], " +
    "[data-type~='tag'], [data-type~='inline-memo'], [data-type='inline-math'], " +
    "img, input, textarea, button, select, audio, video, iframe";

export interface ITableTouchState {
    cell: HTMLTableCellElement;
    table: HTMLTableElement;
    grid: ITableGrid;
    row: {index: number, top: number, bottom: number};
    column: {index: number, left: number, right: number};
    viewport: {left: number, top: number, right: number, bottom: number};
    selection?: {
        mode: SelectionMode;
        cells: HTMLTableCellElement[];
        indexes: Set<number>;
        rectangle: boolean;
    };
}

interface ITableTouchActions {
    enabled: () => boolean;
    activate: (cell: HTMLTableCellElement) => boolean;
    state: () => ITableTouchState | undefined;
    select: (cell: HTMLTableCellElement, mode: SelectionMode, toggle: boolean, extend?: boolean) => boolean;
    range: (anchor: HTMLTableCellElement, active: HTMLTableCellElement) => void;
    drag: (event: PointerEvent, cell: HTMLTableCellElement, mode: "row" | "column", handle: HTMLElement) => void;
    resize: (event: PointerEvent, cell: HTMLTableCellElement, type: "add-row" | "add-column" | "add-both") => void;
    add: (cell: HTMLTableCellElement, type: "add-row" | "add-column" | "add-both") => void;
    width: (event: PointerEvent, cell: HTMLTableCellElement, column: number) => void;
    height: (event: PointerEvent, cell: HTMLTableCellElement, row: HTMLTableRowElement) => void;
    menu: () => void;
    selectAll: () => void;
    copy: () => void;
    clear: () => void;
    finish: () => void;
    render: () => void;
}

// 触摸层只管理入口和手势，表格修改、合并边界与事务由共享控制器处理。
export class TableTouchControl {
    private controls = document.createElement("div");
    private toolbar = document.createElement("div");
    private endpoints: HTMLButtonElement[];
    private multiSelect = false;
    private controller = new AbortController();
    private gesture?: AbortController;
    private scrollFrame: number;
    private dragging?: "controls" | "range";
    private longPress?: {
        cell: HTMLTableCellElement, identifier: number, clientX: number, clientY: number, timer: number, selected: boolean,
    };
    private longPressContextCell?: HTMLTableCellElement;
    private columnBoundary?: {cell: HTMLTableCellElement, column: number};
    private rowBoundary?: {cell: HTMLTableCellElement, row: HTMLTableRowElement};

    constructor(editor: HTMLElement, container: HTMLElement, private content: () => HTMLElement,
                private actions: ITableTouchActions) {
        container.classList.add("protyle-table-control--touch");
        container.dataset.preventSwipe = "true";
        this.controls.dataset.tableTouchControls = "true";
        this.toolbar.className = "protyle-util protyle-util--mobile protyle-table-control__toolbar fn__none";
        this.toolbar.dataset.preventSwipe = "true";
        renderMultiSelectToolbar(this.toolbar, 0, actions.menu, actions.finish, actions.selectAll, [{
            type: "multi",
            icon: "iconSelect",
            label: window.siyuan.languages.multiSelect,
            click: () => {
                this.multiSelect = !this.multiSelect;
                this.actions.render();
            },
        }, {
            type: "copy",
            icon: "iconCopy",
            label: window.siyuan.languages.copy,
            click: actions.copy,
        }, {
            type: "clear",
            icon: "iconClear",
            label: window.siyuan.languages.clear,
            click: actions.clear,
        }]);
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", window.siyuan.languages.table);
        this.endpoints = ["start", "end"].map(endpoint => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "block__icon block__icon--show protyle-table-control__endpoint fn__none";
            button.dataset.endpoint = endpoint;
            button.setAttribute("aria-label", window.siyuan.languages.tableSelectRange);
            return button;
        });
        container.append(this.controls, ...this.endpoints);
        container.after(this.toolbar);
        const signal = this.controller.signal;
        this.toolbar.addEventListener("pointerdown", event => event.preventDefault(), {signal});
        this.endpoints.forEach(button => button.addEventListener("pointerdown", event =>
            this.startRangeDrag(event, button.dataset.endpoint === "start"), {signal}));
        document.addEventListener("touchstart", event => this.startLongPress(event, editor), {capture: true, signal});
        document.addEventListener("touchmove", event => {
            const press = this.longPress;
            if (!press) {
                return;
            }
            const point = Array.from(event.touches).find(touch => touch.identifier === press.identifier);
            if (event.touches.length !== 1 || !point) {
                this.cancelLongPress();
            } else if (press.selected) {
                event.preventDefault();
            } else if (Math.max(Math.abs(point.clientX - press.clientX), Math.abs(point.clientY - press.clientY)) >=
                Constants.SIZE_DRAG_THRESHOLD) {
                this.cancelLongPress();
            }
        }, {capture: true, passive: false, signal});
        document.addEventListener("touchend", event => {
            const press = this.longPress;
            if (!press || !Array.from(event.changedTouches).some(touch => touch.identifier === press.identifier)) {
                return;
            }
            if (press.selected) {
                event.preventDefault();
            }
            this.cancelLongPress();
        }, {capture: true, passive: false, signal});
        document.addEventListener("touchcancel", () => this.cancelLongPress(), {capture: true, signal});
        document.addEventListener("scroll", () => {
            if (!this.longPress?.selected) {
                this.cancelLongPress();
            }
        }, {capture: true, signal});
        document.addEventListener("contextmenu", event => {
            const cell = (event.target as Element).closest("td, th");
            if (cell && (cell === this.longPress?.cell || cell === this.longPressContextCell)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        }, {capture: true, signal});
        document.addEventListener("pointerdown", event => {
            if (event.pointerType !== "touch") {
                this.longPressContextCell = undefined;
            }
            if (this.columnBoundary && !this.controls.querySelector('[data-action="width"]')?.contains(event.target as Node)) {
                this.columnBoundary = undefined;
                this.actions.render();
            }
            if (this.rowBoundary && !this.controls.querySelector('[data-action="height"]')?.contains(event.target as Node)) {
                this.rowBoundary = undefined;
                this.actions.render();
            }
        }, {capture: true, signal});
        // 点击改变选区，滑动内容仍交给浏览器滚动，不在 pointerdown 阶段阻止默认行为。
        editor.addEventListener("click", event => {
            if (this.activateRowBoundary(event, editor) || this.activateColumnBoundary(event, editor)) {
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            const state = this.getState();
            const cell = (event.target as Element).closest<HTMLTableCellElement>("th, td");
            if (!state?.selection || !cell || cell.closest("table") !== state.table) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            this.actions.select(cell, this.multiSelect ? state.selection.mode : "cell", this.multiSelect);
        }, {capture: true, signal});
        window.addEventListener("blur", () => this.cancelGesture(), {signal});
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                this.cancelGesture();
            }
        }, {signal});
    }

    public reset() {
        this.multiSelect = false;
        this.longPressContextCell = undefined;
        this.columnBoundary = undefined;
        this.rowBoundary = undefined;
        this.cancelGesture();
    }

    public containsToolbar(target: Node) {
        return this.toolbar.contains(target);
    }

    public destroy() {
        this.reset();
        this.controller.abort();
        this.controls.remove();
        this.toolbar.remove();
        this.endpoints.forEach(button => button.remove());
    }

    public render() {
        const wasHidden = this.toolbar.classList.contains("fn__none");
        const selecting = !!this.actions.state()?.selection;
        this.toolbar.classList.toggle("fn__none", !selecting);
        if (selecting && wasHidden) {
            this.toolbar.style.zIndex = (++window.siyuan.zIndex).toString();
        }
        const state = this.getState();
        updateMultiSelectToolbar(this.toolbar, state?.selection?.cells.length || 0);
        const multi = this.toolbar.querySelector('[data-type="multi"]');
        multi.setAttribute("aria-pressed", String(this.multiSelect));
        multi.classList.toggle("block__icon--active", this.multiSelect);
        const copy = this.toolbar.querySelector<HTMLButtonElement>('[data-type="copy"]');
        copy.disabled = !!state?.selection && state.selection.mode === "cell" && !state.selection.rectangle;
        if (this.dragging === "controls") {
            this.renderEndpoints(state);
            return;
        }
        this.endpoints.forEach(button => button.classList.add("fn__none"));
        this.controls.replaceChildren();
        if (!state || state.viewport.right <= state.viewport.left || state.viewport.bottom <= state.viewport.top) {
            return;
        }
        const {viewport, cell, table, selection} = state;
        const rowRect = state.row;
        if (rowRect.bottom > viewport.top && rowRect.top < viewport.bottom) {
            const row = this.button(window.siyuan.languages.row, "iconDrag", viewport.left,
                (Math.max(rowRect.top, viewport.top) + Math.min(rowRect.bottom, viewport.bottom)) / 2, false);
            row.className = "protyle-table-control__handle protyle-table-control__handle--row protyle-table-control__handle--active protyle-table-control__touch-handle";
            row.style.height = `${Math.min(rowRect.bottom, viewport.bottom) - Math.max(rowRect.top, viewport.top)}px`;
            row.dataset.mode = "row";
            row.setAttribute("aria-pressed", String(selection?.mode === "row" && selection.indexes.has(rowRect.index)));
            row.addEventListener("pointerdown", event => this.selectHandle(event, cell, "row", row));
        }
        const columnRect = state.column;
        if (columnRect.right > viewport.left && columnRect.left < viewport.right) {
            const column = this.button(window.siyuan.languages.column, "iconDrag",
                (Math.max(columnRect.left, viewport.left) + Math.min(columnRect.right, viewport.right)) / 2, viewport.top, false);
            column.className = "protyle-table-control__handle protyle-table-control__handle--column protyle-table-control__handle--active protyle-table-control__touch-handle";
            column.style.width = `${Math.min(columnRect.right, viewport.right) - Math.max(columnRect.left, viewport.left)}px`;
            column.dataset.mode = "column";
            column.setAttribute("aria-pressed", String(selection?.mode === "column" && selection.indexes.has(columnRect.index)));
            column.addEventListener("pointerdown", event => this.selectHandle(event, cell, "column", column));
        }
        this.renderColumnBoundary(state);
        this.renderRowBoundary(state);
        const tableRect = table.getBoundingClientRect();
        const addOffset = TABLE_ADD_CONTROL_GAP + TABLE_ADD_CONTROL_THICKNESS / 2;
        if (tableRect.bottom <= viewport.bottom + 1) {
            this.addResize(cell, "add-row", viewport.left + (viewport.right - viewport.left) / 2,
                tableRect.bottom + addOffset, viewport.right - viewport.left, TABLE_ADD_CONTROL_THICKNESS);
        }
        if (tableRect.right <= viewport.right + 1) {
            this.addResize(cell, "add-column", tableRect.right + addOffset,
                viewport.top + (viewport.bottom - viewport.top) / 2, TABLE_ADD_CONTROL_THICKNESS, viewport.bottom - viewport.top);
        }
        if (tableRect.bottom <= viewport.bottom + 1 && tableRect.right <= viewport.right + 1) {
            this.addResize(cell, "add-both", tableRect.right + addOffset, tableRect.bottom + addOffset,
                TABLE_ADD_CONTROL_THICKNESS, TABLE_ADD_CONTROL_THICKNESS);
        }
        this.renderEndpoints(state);
    }

    public renderResize() {
        this.controls.querySelectorAll<HTMLElement>(".protyle-table-control__handle, .protyle-table-control__width-guide, .protyle-table-control__height-guide")
            .forEach(control => control.classList.add("fn__none"));
        this.endpoints.forEach(button => button.classList.add("fn__none"));
        return ["add-row", "add-column", "add-both"].map(type =>
            this.controls.querySelector<HTMLButtonElement>(`[data-action="${type}"]`));
    }

    private renderEndpoints(state?: ITableTouchState) {
        this.endpoints.forEach(button => button.classList.add("fn__none"));
        const selection = state?.selection;
        if (selection?.cells.length && (selection.mode !== "cell" || selection.rectangle)) {
            const {grid, viewport} = state;
            const cells = new Set(selection.cells);
            const infos = grid.cellInfos.filter(info => cells.has(info.cell));
            if (!infos.length) {
                return;
            }
            const first = infos.reduce((a, b) => a.row < b.row || a.row === b.row && a.col < b.col ? a : b);
            const last = infos.reduce((a, b) => a.row + a.rowspan > b.row + b.rowspan ||
                a.row + a.rowspan === b.row + b.rowspan && a.col + a.colspan > b.col + b.colspan ? a : b);
            [first.cell.getBoundingClientRect(), last.cell.getBoundingClientRect()].forEach((rect, index) => {
                const x = index === 0 ? rect.left : rect.right;
                const y = index === 0 ? rect.top : rect.bottom;
                if (x >= viewport.left - 1 && x <= viewport.right + 1 && y >= viewport.top - 1 && y <= viewport.bottom + 1) {
                    const button = this.endpoints[index];
                    button.style.left = `${x}px`;
                    button.style.top = `${y}px`;
                    button.classList.remove("fn__none");
                }
            });
        }
    }

    private button(label: string, icon: string | undefined, left: number, top: number, clampToScreen = true) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "block__icon block__icon--show protyle-table-control__touch-button";
        button.setAttribute("aria-label", label);
        button.innerHTML = icon ? `<svg><use xlink:href="#${icon}"></use></svg>` : "";
        button.style.left = `${clampToScreen ? Math.max(16, Math.min(window.innerWidth - 16, left)) : left}px`;
        button.style.top = `${clampToScreen ? Math.max(16, Math.min(window.innerHeight - 72, top)) : top}px`;
        this.controls.append(button);
        return button;
    }

    private getState() {
        const state = this.actions.state();
        if (state?.selection && !this.toolbar.classList.contains("fn__none")) {
            state.viewport.top = Math.max(state.viewport.top, this.toolbar.getBoundingClientRect().bottom + 8);
        }
        return state;
    }

    private activateRowBoundary(event: MouseEvent, editor: HTMLElement) {
        const target = event.target as Element;
        const cell = target.closest<HTMLTableCellElement>("td, th");
        if (event.defaultPrevented || !this.actions.enabled() || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || target.closest(TABLE_TOUCH_INTERACTIVE_SELECTOR) ||
            !cell?.closest('[data-type="NodeTable"]') || cell.closest(".protyle-wysiwyg") !== editor ||
            cell.closest(`tr[${TABLE_VIRTUAL_ROWS}]`)) {
            return false;
        }
        const row = getTableRowBoundary(cell, event.clientX, event.clientY, 8);
        if (!row || !this.actions.activate(cell)) {
            return false;
        }
        this.rowBoundary = {cell, row};
        this.actions.render();
        return true;
    }

    private renderRowBoundary(state: ITableTouchState) {
        const boundary = this.rowBoundary;
        if (!boundary?.row.isConnected || boundary.cell.closest("table") !== state.table) {
            return;
        }
        const {viewport} = state;
        const edge = boundary.row.getBoundingClientRect().bottom;
        if (edge <= viewport.top || edge > viewport.bottom + 1) {
            return;
        }
        const guide = document.createElement("div");
        guide.className = "protyle-table-control__height-guide";
        guide.style.left = `${viewport.left}px`;
        guide.style.top = `${edge}px`;
        guide.style.width = `${viewport.right - viewport.left}px`;
        this.controls.append(guide);
        const height = this.button(window.siyuan.languages.height, undefined, (viewport.left + viewport.right) / 2, edge, false);
        height.className = "protyle-table-control__handle protyle-table-control__height";
        height.style.width = `${viewport.right - viewport.left}px`;
        height.dataset.action = "height";
        height.setAttribute("aria-pressed", "true");
        height.addEventListener("pointerdown", event => {
            if (event.button !== 0 || !this.actions.enabled()) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.holdControls(event);
            Array.from(this.controls.children).forEach(control => {
                if (control !== height && control !== guide) {
                    control.classList.add("fn__none");
                }
            });
            this.actions.height(event, boundary.cell, boundary.row);
            document.addEventListener("pointermove", move => {
                if (move.pointerId === event.pointerId) {
                    const top = `${boundary.row.getBoundingClientRect().bottom}px`;
                    guide.style.top = top;
                    height.style.top = top;
                }
            }, {signal: this.gesture.signal});
        });
    }

    private activateColumnBoundary(event: MouseEvent, editor: HTMLElement) {
        const target = event.target as Element;
        const cell = target.closest<HTMLTableCellElement>("td, th");
        const table = cell?.closest("table");
        if (event.defaultPrevented || !this.actions.enabled() || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || target.closest(TABLE_TOUCH_INTERACTIVE_SELECTOR) ||
            !cell?.closest('[data-type="NodeTable"]') || cell.closest(".protyle-wysiwyg") !== editor ||
            cell.closest(`tr[${TABLE_VIRTUAL_ROWS}]`)) {
            return false;
        }
        const columns = Array.from(table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col"));
        const rect = cell.getBoundingClientRect();
        // 窄单元格保留中间的文字点击区域，分隔线仍可进入列宽调整。
        const tolerance = Math.min(8, rect.width / 4);
        if (Math.min(Math.abs(rect.left - event.clientX), Math.abs(rect.right - event.clientX)) > tolerance) {
            return false;
        }
        // 点击可见的单元格分隔线后激活列宽调整，合并单元格内部没有分隔线的位置不响应。
        const index = columns.findIndex(column => Math.abs(column.getBoundingClientRect().right - event.clientX) <= tolerance);
        if (index < 0 || !this.actions.activate(cell)) {
            return false;
        }
        this.columnBoundary = {cell, column: index};
        this.actions.render();
        return true;
    }

    private renderColumnBoundary(state: ITableTouchState) {
        const boundary = this.columnBoundary;
        if (!boundary?.cell.isConnected || boundary.cell.closest("table") !== state.table) {
            return;
        }
        const {table, viewport} = state;
        const column = table.querySelectorAll<HTMLTableColElement>(":scope > colgroup > col")[boundary.column];
        const edge = column?.getBoundingClientRect().right;
        const top = viewport.top;
        const bottom = viewport.bottom;
        if (typeof edge !== "number" || edge <= viewport.left || edge > viewport.right + 1 || bottom <= top) {
            return;
        }
        const guide = document.createElement("div");
        guide.className = "protyle-table-control__width-guide";
        guide.style.left = `${edge}px`;
        guide.style.top = `${viewport.top}px`;
        guide.style.height = `${viewport.bottom - viewport.top}px`;
        this.controls.append(guide);
        const width = this.button(window.siyuan.languages.width, undefined, edge, (top + bottom) / 2, false);
        width.className = "protyle-table-control__handle protyle-table-control__width";
        width.style.height = `${bottom - top}px`;
        width.dataset.action = "width";
        width.setAttribute("aria-pressed", "true");
        width.addEventListener("pointerdown", event => {
            if (event.button !== 0 || !this.actions.enabled()) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.holdControls(event);
            Array.from(this.controls.children).forEach(control => {
                if (control !== width && control !== guide) {
                    control.classList.add("fn__none");
                }
            });
            this.actions.width(event, boundary.cell, boundary.column);
            document.addEventListener("pointermove", move => {
                if (move.pointerId === event.pointerId) {
                    const left = `${column.getBoundingClientRect().right}px`;
                    guide.style.left = left;
                    width.style.left = left;
                }
            }, {signal: this.gesture.signal});
        });
    }

    private startLongPress(event: TouchEvent, editor: HTMLElement) {
        this.cancelLongPress();
        this.longPressContextCell = undefined;
        const target = event.target as Element;
        const cell = target.closest<HTMLTableCellElement>("td, th");
        if (event.defaultPrevented || event.touches.length !== 1 || !this.actions.enabled() ||
            this.actions.state()?.selection || !cell?.closest('[data-type="NodeTable"]') ||
            cell.closest(".protyle-wysiwyg") !== editor || editor.closest(".fn__none, [inert]") ||
            cell.closest(`tr[${TABLE_VIRTUAL_ROWS}]`) || cell.querySelector(".table__cell-editor") ||
            target.closest(TABLE_TOUCH_INTERACTIVE_SELECTOR)) {
            return;
        }
        const {identifier, clientX, clientY} = event.touches[0];
        const press = {cell, identifier, clientX, clientY, timer: 0, selected: false};
        this.longPress = press;
        // 仅在待识别的单元格上关闭原生选词，编辑中的单元格保留文字长按行为。
        cell.classList.add("table__cell--touch-selecting");
        press.timer = window.setTimeout(() => {
            if (!this.actions.enabled() || !cell.isConnected || cell.querySelector(".table__cell-editor")) {
                this.cancelLongPress();
                return;
            }
            press.selected = this.actions.select(cell, "cell", false);
            if (press.selected) {
                this.longPressContextCell = cell;
            } else {
                this.cancelLongPress();
            }
        }, Constants.TIMEOUT_LONGPRESS);
    }

    private cancelLongPress() {
        if (this.longPress) {
            clearTimeout(this.longPress.timer);
            this.longPress.cell.classList.remove("table__cell--touch-selecting");
            this.longPress = undefined;
        }
    }

    private selectHandle(event: PointerEvent, cell: HTMLTableCellElement, mode: "row" | "column", handle: HTMLElement) {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const state = this.getState();
        // 拖动已选行列时保留整个选区，多选开关开启后点击手柄切换选中状态。
        const selected = state?.selection?.mode === mode && state.selection.cells.includes(cell);
        if ((!selected || this.multiSelect) && !this.actions.select(cell, mode, this.multiSelect)) {
            return;
        }
        if (!this.multiSelect) {
            this.holdControls(event);
            this.actions.drag(event, cell, mode, handle);
        }
    }

    private addResize(cell: HTMLTableCellElement, type: "add-row" | "add-column" | "add-both",
                      x: number, y: number, width: number, height: number) {
        const button = this.button(type === "add-column" ? window.siyuan.languages.tableAddColumnTip :
            window.siyuan.languages.tableAddRowTip, type === "add-both" ? "iconMove" : "iconAdd", x, y);
        button.dataset.action = type;
        button.className = `protyle-table-control__add protyle-table-control__add--${type.substring(4)} protyle-table-control__touch-add`;
        button.style.width = `${width}px`;
        button.style.height = `${height}px`;
        button.addEventListener("pointerdown", event => {
            event.preventDefault();
            button.classList.add("protyle-table-control__add--active");
            this.holdControls(event);
            this.actions.resize(event, cell, type);
        });
        button.addEventListener("click", () => this.actions.add(cell, type));
    }

    private holdControls(event: PointerEvent) {
        this.cancelGesture();
        this.dragging = "controls";
        this.gesture = new AbortController();
        const end = (up: PointerEvent) => {
            if (up.pointerId === event.pointerId) {
                this.cancelGesture();
                this.actions.render();
            }
        };
        document.addEventListener("pointerup", end, {signal: this.gesture.signal});
        document.addEventListener("pointercancel", end, {signal: this.gesture.signal});
    }

    private startRangeDrag(event: PointerEvent, start: boolean) {
        const state = this.getState();
        if (event.button !== 0 || !state?.selection?.cells.length) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancelGesture();
        const cells = new Set(state.selection.cells);
        const infos = state.grid.cellInfos.filter(info => cells.has(info.cell));
        const top = Math.min(...infos.map(info => info.row));
        const left = Math.min(...infos.map(info => info.col));
        const bottom = Math.max(...infos.map(info => info.row + info.rowspan - 1));
        const right = Math.max(...infos.map(info => info.col + info.colspan - 1));
        const anchor = state.grid.grid[start ? bottom : top]?.[start ? right : left];
        if (!anchor) {
            return;
        }
        this.dragging = "range";
        const controller = new AbortController();
        this.gesture = controller;
        const signal = controller.signal;
        let point = {clientX: event.clientX, clientY: event.clientY};
        let moved = false;
        const update = () => {
            const current = this.getState();
            if (!current?.selection) {
                this.cancelGesture();
                return;
            }
            const viewport = current.viewport;
            const x = Math.min(Math.max(point.clientX, viewport.left + 2), viewport.right - 2);
            const y = Math.min(Math.max(point.clientY, viewport.top + 2), viewport.bottom - 2);
            const target = document.elementsFromPoint(x, y).map(element => element.closest<HTMLTableCellElement>("th, td"))
                .find(candidate => candidate?.closest("table") === current.table);
            if (target?.closest("table") === current.table && !target.closest(`tr[${TABLE_VIRTUAL_ROWS}]`)) {
                if (state.selection.mode === "cell") {
                    this.actions.range(anchor, target);
                } else {
                    this.actions.select(anchor, state.selection.mode, false);
                    this.actions.select(target, state.selection.mode, false, true);
                }
            }
        };
        document.addEventListener("pointermove", move => {
            if (move.pointerId !== event.pointerId) {
                return;
            }
            move.preventDefault();
            point = move;
            if (!moved) {
                if (Math.hypot(move.clientX - event.clientX, move.clientY - event.clientY) < Constants.SIZE_DRAG_THRESHOLD) {
                    return;
                }
                moved = true;
                this.scrollFrame = requestAnimationFrame(scroll);
            }
            update();
        }, {signal, passive: false});
        const end = (up: PointerEvent) => {
            if (up.pointerId === event.pointerId) {
                this.cancelGesture();
                this.actions.render();
            }
        };
        document.addEventListener("pointerup", end, {signal});
        document.addEventListener("pointercancel", end, {signal});
        const scroll = () => {
            const current = this.getState();
            if (!this.gesture || !current?.selection) {
                return;
            }
            const content = this.content();
            const contentRect = content.getBoundingClientRect();
            const visualViewport = window.visualViewport;
            const left = Math.max(contentRect.left, visualViewport?.offsetLeft || 0);
            const right = Math.min(contentRect.right, window.innerWidth,
                (visualViewport?.offsetLeft || 0) + (visualViewport?.width || window.innerWidth));
            const top = Math.max(contentRect.top, visualViewport?.offsetTop || 0, this.toolbar.getBoundingClientRect().bottom + 8);
            const bottom = Math.min(contentRect.bottom, window.innerHeight,
                (visualViewport?.offsetTop || 0) + (visualViewport?.height || window.innerHeight));
            const wrapper = current.table.parentElement;
            const wrapperRect = wrapper.getBoundingClientRect();
            const delta = (value: number, min: number, max: number) => value < min + 28 ? -10 : value > max - 28 ? 10 : 0;
            const scrollLeft = wrapper.scrollLeft;
            const scrollTop = wrapper.scrollTop;
            const contentScrollTop = content.scrollTop;
            if (wrapper.scrollWidth > wrapper.clientWidth) {
                wrapper.scrollLeft += delta(point.clientX, Math.max(wrapperRect.left, left), Math.min(wrapperRect.right, right));
            }
            if (wrapper.scrollHeight > wrapper.clientHeight) {
                wrapper.scrollTop += delta(point.clientY, Math.max(wrapperRect.top, top), Math.min(wrapperRect.bottom, bottom));
            }
            // 表格内部先滚动；只有滚动视口外仍有表格内容时才滚动正文，避免越过表格继续滚动。
            const dy = delta(point.clientY, top, bottom);
            const tableRect = current.table.getBoundingClientRect();
            if (wrapper.scrollTop === scrollTop && (dy < 0 && Math.max(wrapperRect.top, tableRect.top) < top ||
                dy > 0 && Math.min(wrapperRect.bottom, tableRect.bottom) > bottom)) {
                content.scrollTop += dy;
            }
            if (wrapper.scrollLeft !== scrollLeft || wrapper.scrollTop !== scrollTop || content.scrollTop !== contentScrollTop) {
                update();
                this.actions.render();
            }
            this.scrollFrame = requestAnimationFrame(scroll);
        };
    }

    private cancelGesture() {
        this.cancelLongPress();
        this.gesture?.abort();
        this.gesture = undefined;
        this.dragging = undefined;
        cancelAnimationFrame(this.scrollFrame);
    }
}
