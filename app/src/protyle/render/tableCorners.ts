import {Constants} from "../../constants";

const observers = new WeakMap<Element, MutationObserver>();

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
        const value = corners.get(cell)?.join(" ");
        if (value) {
            if (cell.getAttribute(Constants.TABLE_CELL_CORNER) !== value) {
                cell.setAttribute(Constants.TABLE_CELL_CORNER, value);
            }
        } else if (cell.hasAttribute(Constants.TABLE_CELL_CORNER)) {
            cell.removeAttribute(Constants.TABLE_CELL_CORNER);
        }
    });
};

export const renderTableCorners = (root: Element) => {
    const tables = new Set<HTMLTableElement>();
    collectTables(root, tables);
    tables.forEach(renderTable);
};

export const destroyTableCorners = (root: Element) => {
    observers.get(root)?.disconnect();
    observers.delete(root);
};

export const observeTableCorners = (root: Element) => {
    destroyTableCorners(root);
    renderTableCorners(root);
    const observer = new MutationObserver(records => {
        const tables = new Set<HTMLTableElement>();
        records.forEach(record => {
            if (record.type === "attributes") {
                const cell = record.target as Element;
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
                renderTable(table);
            }
        });
    });
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeOldValue: true,
        attributeFilter: ["rowspan", "colspan", "class"]});
    observers.set(root, observer);
};
