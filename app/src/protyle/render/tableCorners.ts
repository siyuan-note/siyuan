import {Constants} from "../../constants";
import {TABLE_VIRTUAL_ROWS} from "../util/tableVirtualizationDOM";

interface IPinnedColumn {
    cell: HTMLTableCellElement;
    viewport: HTMLElement;
    resize: ResizeObserver;
}

const observers = new WeakMap<Element, {mutation: MutationObserver, pinnedColumns: Map<HTMLTableElement, IPinnedColumn>}>();
const pinColumnTable = `[data-type="NodeTable"][${Constants.CUSTOM_SY_TABLE_PIN_COLUMN}="true"] > div:first-child > table`;

const collectTables = (root: Element, tables: Set<HTMLTableElement>) => {
    const table = root.closest<HTMLTableElement>("table");
    if (table) {
        tables.add(table);
    }
    root.querySelectorAll<HTMLTableElement>("table").forEach(item => tables.add(item));
};

const renderTable = (table: HTMLTableElement) => {
    const rows = Array.from(table.rows);
    const cells = rows.flatMap(row => Array.from(row.cells));
    const corners = new Map<HTMLTableCellElement, string[]>();
    const pinnedCells = table.matches(pinColumnTable) ? new Set<HTMLTableCellElement>() : undefined;
    let firstPinnedCell: HTMLTableCellElement;
    let occupied: {cell: HTMLTableCellElement, end: number}[] = [];
    let section: Element;
    let sectionEnd = 0;
    let columns = 0;
    let bottom: HTMLTableCellElement[] = [];
    rows.forEach((row, index) => {
        if (row.parentElement !== section) {
            section = row.parentElement;
            sectionEnd = index + 1;
            while (sectionEnd < rows.length && rows[sectionEnd].parentElement === section) {
                sectionEnd++;
            }
            occupied = [];
        }
        let column = 0;
        Array.from(row.cells).forEach(cell => {
            if (cell.classList.contains("fn__none")) {
                return;
            }
            while (occupied[column]?.end > index) {
                column++;
            }
            if (pinnedCells && column === 0 && cell.colSpan === 1 && !row.hasAttribute(TABLE_VIRTUAL_ROWS)) {
                pinnedCells.add(cell);
                firstPinnedCell ??= cell;
            }
            const end = cell.rowSpan === 0 ? sectionEnd : Math.min(sectionEnd, index + cell.rowSpan);
            for (let offset = 0; offset < cell.colSpan; offset++) {
                occupied[column++] = {cell, end};
            }
        });
        columns = Math.max(columns, column, occupied.length);
        bottom = occupied.map(item => item?.end > index ? item.cell : undefined);
    });
    const left = bottom[0];
    const right = bottom[columns - 1];
    if (left) {
        corners.set(left, ["bottom-left"]);
    }
    if (right) {
        corners.set(right, [...(corners.get(right) || []), "bottom-right"]);
    }
    if (!table.hasAttribute(Constants.TABLE_CORNERS)) {
        table.setAttribute(Constants.TABLE_CORNERS, "");
    }
    cells.forEach(cell => {
        cell.toggleAttribute(Constants.TABLE_PINNED_COLUMN_CELL, pinnedCells?.has(cell) ?? false);
        const value = corners.get(cell)?.join(" ");
        if (value) {
            if (cell.getAttribute(Constants.TABLE_CELL_CORNER) !== value) {
                cell.setAttribute(Constants.TABLE_CELL_CORNER, value);
            }
        } else if (cell.hasAttribute(Constants.TABLE_CELL_CORNER)) {
            cell.removeAttribute(Constants.TABLE_CELL_CORNER);
        }
    });
    return firstPinnedCell;
};

export const renderTableCorners = (root: Element) => {
    const tables = new Set<HTMLTableElement>();
    collectTables(root, tables);
    tables.forEach(renderTable);
};

export const destroyTableCorners = (root: Element) => {
    const state = observers.get(root);
    state?.mutation.disconnect();
    state?.pinnedColumns.forEach(({resize}) => resize.disconnect());
    observers.delete(root);
};

export const observeTableCorners = (root: Element) => {
    destroyTableCorners(root);
    const pinnedColumns = new Map<HTMLTableElement, IPinnedColumn>();
    const refreshTable = (table: HTMLTableElement) => {
        const cell = renderTable(table);
        const viewport = table.parentElement;
        const previous = pinnedColumns.get(table);
        if (previous?.cell === cell && previous?.viewport === viewport) {
            return;
        }
        previous?.resize.disconnect();
        if (!cell) {
            pinnedColumns.delete(table);
            table.removeAttribute(Constants.TABLE_PINNED_COLUMN_ACTIVE);
            return;
        }
        const refresh = () => {
            const width = cell.offsetWidth;
            // 为可滚动列保留操作空间，容器变宽后自动恢复固定状态。
            table.toggleAttribute(Constants.TABLE_PINNED_COLUMN_ACTIVE, width > 0 && width + 80 <= viewport.clientWidth);
        };
        const resize = new ResizeObserver(refresh);
        resize.observe(viewport);
        resize.observe(cell, {box: "border-box"});
        pinnedColumns.set(table, {cell, viewport, resize});
        refresh();
    };
    const tables = new Set<HTMLTableElement>();
    collectTables(root, tables);
    tables.forEach(refreshTable);
    const mutation = new MutationObserver(records => {
        const tables = new Set<HTMLTableElement>();
        records.forEach(record => {
            if (record.type === "attributes") {
                const cell = record.target as Element;
                if (record.attributeName === Constants.CUSTOM_SY_TABLE_PIN_COLUMN) {
                    collectTables(cell, tables);
                    return;
                }
                if (!cell.matches("td, th") || record.attributeName === "class" &&
                    (record.oldValue || "").split(/\s+/).includes("fn__none") === cell.classList.contains("fn__none")) {
                    return;
                }
            } else if (![...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
                (node.matches("table, tr, td, th, thead, tbody, tfoot") || !!node.querySelector("table, tr, td, th")))) {
                return;
            }
            if (record.target instanceof Element) {
                const table = record.target.closest<HTMLTableElement>("table");
                if (table) {
                    tables.add(table);
                }
            }
            record.addedNodes.forEach(node => {
                if (node instanceof Element) {
                    collectTables(node, tables);
                }
            });
        });
        tables.forEach(table => {
            if (root.contains(table)) {
                refreshTable(table);
            }
        });
        pinnedColumns.forEach(({resize}, table) => {
            if (!root.contains(table)) {
                resize.disconnect();
                pinnedColumns.delete(table);
            }
        });
    });
    mutation.observe(root, {subtree: true, childList: true, attributes: true, attributeOldValue: true,
        attributeFilter: ["rowspan", "colspan", "class", Constants.CUSTOM_SY_TABLE_PIN_COLUMN]});
    observers.set(root, {mutation, pinnedColumns});
};
