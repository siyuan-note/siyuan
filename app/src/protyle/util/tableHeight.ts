import {Constants} from "../../constants";
import {openInputDialog} from "../../dialog/inputDialog";
import {transaction} from "../wysiwyg/transaction";
import {finishTableCellEditing} from "./tableCellRichContext";

const TABLE_MIN_HEIGHT = 64;
const heightAttribute = Constants.CUSTOM_SY_TABLE_HEIGHT;
const heightProperty = "--b3-table-max-height";
const previewProperty = "--b3-table-preview-max-height";

const getStoredTableHeight = (node: Element) => {
    const value = node.getAttribute(heightAttribute);
    const match = value?.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) {
        return;
    }
    const height = Number(match[1]);
    return Number.isFinite(height) ? Math.max(TABLE_MIN_HEIGHT, height) : undefined;
};

export const applyTableHeight = (node: Element, scroller: HTMLElement) => {
    const height = getStoredTableHeight(node);
    const value = height === undefined ? "" : `${height}px`;
    if (scroller.style.getPropertyValue(heightProperty) !== value) {
        scroller.style.setProperty(heightProperty, value);
    }
};

const getTableMinHeight = (table: HTMLTableElement, pinned: boolean) =>
    Math.max(TABLE_MIN_HEIGHT, pinned ? (table.tHead?.offsetHeight || 0) + 24 : 0);

const setTableHeight = (protyle: IProtyle, node: Element, scroller: HTMLElement, height?: number) => {
    if (!node.isConnected || protyle.disabled || scroller.parentElement !== node) {
        return;
    }
    const previous = node.getAttribute(heightAttribute) || "";
    const next = height === undefined ? "" : `${height}px`;
    if (next === previous) {
        return;
    }
    if (next) {
        node.setAttribute(heightAttribute, next);
    } else {
        node.removeAttribute(heightAttribute);
    }
    applyTableHeight(node, scroller);
    const id = node.getAttribute("data-node-id");
    transaction(protyle, [{action: "setAttrs", id, data: JSON.stringify({[heightAttribute]: next})}],
        [{action: "setAttrs", id, data: JSON.stringify({[heightAttribute]: previous})}]);
};

export const openTableHeight = (protyle: IProtyle, node: Element) => {
    const table = node.querySelector<HTMLTableElement>(":scope > div:first-child > table");
    const scroller = table?.parentElement;
    if (!scroller || protyle.disabled) {
        return;
    }
    window.siyuan.menus.menu.remove();
    const languages = window.siyuan.languages;
    const min = getTableMinHeight(table, node.getAttribute("custom-pinthead") === "true");
    const height = getStoredTableHeight(node);
    openInputDialog({
        title: languages.height,
        label: languages.entryPixelHeight,
        type: "number",
        min: String(min),
        max: String(Number.MAX_SAFE_INTEGER),
        step: "1",
        placeholder: languages.default,
        value: height === undefined ? "" : String(height),
        actions: [{
            text: languages.default,
            onClick: (_value, dialog) => {
                setTableHeight(protyle, node, scroller);
                dialog.destroy();
            }
        }],
        onConfirm: (value, dialog) => {
            const input = dialog.element.querySelector<HTMLInputElement>("[data-dialog-input]");
            if (!input.reportValidity()) {
                return;
            }
            setTableHeight(protyle, node, scroller, value === "" ? undefined : Number(value));
            dialog.destroy();
        },
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
        scroller.style.removeProperty(previewProperty);
        scroller.removeAttribute("data-table-height-preview");
        if (!cancel && height !== startHeight) {
            setTableHeight(protyle, node, scroller, height);
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
        scroller.toggleAttribute("data-table-height-preview", height !== startHeight);
        scroller.style.setProperty(previewProperty, height === startHeight ? "" : `${height}px`);
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
