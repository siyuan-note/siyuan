import {Constants} from "../../constants";
import {createBlockHeightMenu} from "../gutter/height";
import {transaction} from "../wysiwyg/transaction";
import {finishTableCellEditing} from "./tableCellRichContext";

const TABLE_MIN_HEIGHT = 64;
const heightAttribute = Constants.CUSTOM_SY_TABLE_HEIGHT;
const heightProperty = "--b3-table-max-height";
const previewProperty = "--b3-table-preview-max-height";

const normalizeTableHeight = (value: string) => {
    const match = value?.match(/^(\d+(?:\.\d+)?)(px|vh)$/);
    const height = Number(match?.[1]);
    if (!Number.isSafeInteger(Math.ceil(height)) || height <= 0) {
        return "";
    }
    return match[2] === "px" ? `${Math.max(TABLE_MIN_HEIGHT, height)}px` :
        `${Math.max(1, Math.min(100, height))}vh`;
};

const getStoredTableHeight = (node: Element) => normalizeTableHeight(node.getAttribute(heightAttribute));
const getCSSHeight = (height: string) => height.endsWith("vh") ? `max(${TABLE_MIN_HEIGHT}px, ${height})` : height;
const getTableScroller = (node: Element) => node.querySelector<HTMLTableElement>(":scope > div:first-child > table")?.parentElement;

export const applyTableHeight = (node: Element, scroller: HTMLElement) => {
    const value = getCSSHeight(getStoredTableHeight(node));
    if (scroller.style.getPropertyValue(heightProperty) !== value) {
        scroller.style.setProperty(heightProperty, value);
    }
};

const getTableMinHeight = (table: HTMLTableElement, pinned: boolean) =>
    Math.max(TABLE_MIN_HEIGHT, pinned ? (table.tHead?.offsetHeight || 0) + 24 : 0);

const setTableHeight = (protyle: IProtyle, nodes: Element[], height: string) => {
    const next = normalizeTableHeight(height);
    if (protyle.disabled || (height && !next)) {
        return;
    }
    const operations: IOperation[] = [];
    const undo: IOperation[] = [];
    for (const node of nodes) {
        const scroller = getTableScroller(node);
        const id = node.getAttribute("data-node-id");
        const previous = node.getAttribute(heightAttribute) || "";
        if (!node.isConnected || !scroller || !id || next === previous) {
            continue;
        }
        if (next) {
            node.setAttribute(heightAttribute, next);
        } else {
            node.removeAttribute(heightAttribute);
        }
        applyTableHeight(node, scroller);
        operations.push({action: "setAttrs", id, data: JSON.stringify({[heightAttribute]: next})});
        undo.push({action: "setAttrs", id, data: JSON.stringify({[heightAttribute]: previous})});
    }
    if (operations.length > 0) {
        transaction(protyle, operations, undo);
    }
};

const previewTableHeight = (scroller: HTMLElement, value?: string) => {
    scroller.toggleAttribute("data-table-height-preview", value !== undefined);
    scroller.style.setProperty(previewProperty, value ?? "");
};

export const createTableHeightMenu = (protyle: IProtyle, nodes: Element[]) => {
    if (protyle.disabled || nodes.length === 0 ||
        nodes.some(node => node.getAttribute("data-type") !== "NodeTable" || !getTableScroller(node))) {
        return;
    }
    const menu = window.siyuan.menus.menu;
    const previewed = new Set<HTMLElement>();
    let pending: string | undefined;
    let boundRemove = false;
    const clear = () => {
        previewed.forEach(scroller => previewTableHeight(scroller));
        previewed.clear();
        pending = undefined;
    };
    const commit = (value: string) => {
        clear();
        setTableHeight(protyle, nodes, value);
    };
    return createBlockHeightMenu(getStoredTableHeight(nodes[0]), height => {
        const value = normalizeTableHeight(height);
        if (protyle.disabled || (height && !value)) {
            clear();
            return;
        }
        if (!boundRemove) {
            const previous = menu.removeCB;
            menu.removeCB = () => {
                boundRemove = false;
                clear();
                previous?.();
            };
            boundRemove = true;
        }
        pending = value;
        for (const node of nodes) {
            const scroller = node.isConnected && getTableScroller(node);
            if (scroller) {
                const fallback = node.getAttribute("custom-pinthead") === "true" ? "50vh" : "none";
                previewTableHeight(scroller, value ? getCSSHeight(value) : fallback);
                previewed.add(scroller);
            }
        }
    }, commit, input => {
        const finish = () => {
            if (pending === undefined) {
                return;
            }
            if (!input.validity.valid) {
                clear();
                return;
            }
            commit(pending);
            menu.remove();
        };
        input.addEventListener(input.type === "number" ? "blur" : "change", finish);
        input.addEventListener("pointercancel", clear);
        input.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                clear();
            } else if (input.type === "number" && event.key === "Enter" && !event.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                finish();
            }
        });
    });
};

export const scrollTableRowIntoView = (table: HTMLTableElement, row: HTMLTableRowElement) => {
    const scroller = table.parentElement;
    if (scroller.scrollHeight <= scroller.clientHeight || getComputedStyle(scroller).overflowY === "hidden") {
        return false;
    }
    const bounds = scroller.getBoundingClientRect();
    const scale = bounds.height / scroller.offsetHeight || 1;
    const rowRect = row.getBoundingClientRect();
    const headerHeight = scroller.parentElement.getAttribute("custom-pinthead") === "true" &&
        table.tHead && !table.tHead.contains(row) ? table.tHead.getBoundingClientRect().height : 0;
    const top = bounds.top + scroller.clientTop * scale + headerHeight;
    const bottom = bounds.top + (scroller.clientTop + scroller.clientHeight) * scale;
    if (rowRect.top < top || rowRect.height > bottom - top) {
        scroller.scrollTop += (rowRect.top - top) / scale;
    } else if (rowRect.bottom > bottom) {
        scroller.scrollTop += (rowRect.bottom - bottom) / scale;
    }
    return true;
};

export const startTableHeightResize = (protyle: IProtyle, cell: HTMLTableCellElement, table: HTMLTableElement,
                                       event: PointerEvent, preview: (height: number, x: number, y: number) => void,
                                       finished: () => void) => {
    const node = table?.closest<HTMLElement>('[data-type="NodeTable"]');
    const scroller = table?.parentElement;
    if (event.button !== 0 || protyle.disabled || !cell?.isConnected || !table?.isConnected || !node ||
        !scroller || !finishTableCellEditing(cell)) {
        return;
    }
    const previous = node.getAttribute(heightAttribute);
    const pinned = node.getAttribute("custom-pinthead");
    const startHeight = scroller.offsetHeight;
    const startY = event.clientY;
    const scale = scroller.getBoundingClientRect().height / startHeight || 1;
    const maxHeight = startHeight + scroller.scrollHeight - scroller.clientHeight;
    const minHeight = Math.min(maxHeight, getTableMinHeight(table, pinned === "true"));
    let height = startHeight;
    const controller = new AbortController();
    const {signal} = controller;
    const canResize = () => !protyle.disabled && scroller.contains(table) && node.isConnected &&
        node.getAttribute("custom-pinthead") === pinned && node.getAttribute(heightAttribute) === previous;
    const finish = (cancel: boolean) => {
        if (signal.aborted) {
            return;
        }
        controller.abort();
        previewTableHeight(scroller);
        if (!cancel && height !== startHeight) {
            setTableHeight(protyle, [node], `${height}px`);
        }
        finished();
    };
    document.addEventListener("pointermove", move => {
        if (move.pointerId !== event.pointerId) {
            return;
        }
        if (!canResize()) {
            finish(true);
            return;
        }
        move.preventDefault();
        height = move.clientY === startY ? startHeight :
            Math.min(maxHeight, Math.max(minHeight, Math.round(startHeight + (move.clientY - startY) / scale)));
        previewTableHeight(scroller, height === startHeight ? undefined : `${height}px`);
        preview(scroller.offsetHeight, move.clientX, move.clientY);
    }, {signal, passive: false});
    const end = (up: PointerEvent) => {
        if (up.pointerId === event.pointerId) {
            finish(up.type === "pointercancel" || !canResize());
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
