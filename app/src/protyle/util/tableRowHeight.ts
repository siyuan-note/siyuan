import {updateTransaction} from "../wysiwyg/transaction";
import {restoreTableVirtualizationDOM, TABLE_VIRTUAL_ROWS} from "./tableVirtualizationDOM";
import {finishTableCellEditing} from "./tableCellRichContext";

// 只命中可见单元格的水平边界，跨行合并单元格内部不生成分隔线。
export const getTableRowBoundary = (cell: HTMLTableCellElement, x: number, y: number, tolerance: number) => {
    const rect = cell.getBoundingClientRect();
    if (x <= rect.left + tolerance || x >= rect.right - tolerance ||
        Math.min(Math.abs(rect.top - y), Math.abs(rect.bottom - y)) > tolerance) {
        return;
    }
    return Array.from(cell.closest("table").rows).find(row => !row.hasAttribute(TABLE_VIRTUAL_ROWS) &&
        Math.abs(row.getBoundingClientRect().bottom - y) <= tolerance);
};

export const getTableRowOpeningHTML = (row: HTMLTableRowElement) => {
    const clone = row?.cloneNode(false) as HTMLTableRowElement;
    return clone ? clone.outerHTML.replace(/<\/tr>$/, "") : "<tr>";
};

export const startTableRowResize = (protyle: IProtyle, cell: HTMLTableCellElement, row: HTMLTableRowElement,
                                    event: PointerEvent, preview: (height: number, x: number, y: number) => void,
                                    finished: () => void) => {
    if (event.button !== 0 || protyle.disabled || !row?.isConnected || !finishTableCellEditing(cell)) {
        return;
    }
    const table = cell.closest("table");
    const node = table?.closest<HTMLElement>('[data-type="NodeTable"]');
    if (!node || row.closest("table") !== table) {
        return;
    }
    restoreTableVirtualizationDOM(table);
    const oldHTML = node.outerHTML;
    const oldStyle = row.getAttribute("style");
    const startHeight = row.getBoundingClientRect().height;
    const startY = event.clientY;
    const controller = new AbortController();
    const {signal} = controller;
    const finish = (cancel: boolean) => {
        if (signal.aborted) {
            return;
        }
        controller.abort();
        if (cancel) {
            if (oldStyle === null) {
                row.removeAttribute("style");
            } else {
                row.setAttribute("style", oldStyle);
            }
        } else if (node.isConnected && node.outerHTML !== oldHTML) {
            updateTransaction(protyle, node, oldHTML);
        }
        finished();
    };
    document.addEventListener("pointermove", move => {
        if (move.pointerId !== event.pointerId) {
            return;
        }
        if (protyle.disabled || !row.isConnected || !node.isConnected) {
            finish(true);
            return;
        }
        move.preventDefault();
        // 表格布局保证内容所需的最小高度；只设置行高，不裁切单元格。
        if (move.clientY !== startY) {
            row.style.height = `${Math.max(1, Math.round(startHeight + move.clientY - startY))}px`;
        } else if (oldStyle === null) {
            row.removeAttribute("style");
        } else {
            row.setAttribute("style", oldStyle);
        }
        preview(Math.round(row.getBoundingClientRect().height), move.clientX, move.clientY);
    }, {signal, passive: false});
    const end = (up: PointerEvent) => {
        if (up.pointerId === event.pointerId) {
            finish(up.type === "pointercancel" || protyle.disabled || !row.isConnected || !node.isConnected);
        }
    };
    document.addEventListener("pointerup", end, {signal});
    document.addEventListener("pointercancel", end, {signal});
    document.addEventListener("keydown", key => {
        if (key.key === "Escape") {
            key.preventDefault();
            finish(true);
        }
    }, {signal, capture: true});
    window.addEventListener("blur", () => finish(true), {signal});
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            finish(true);
        }
    }, {signal});
    return () => finish(true);
};
