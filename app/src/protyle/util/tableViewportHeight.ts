import {Constants} from "../../constants";
import {updateTransaction} from "../wysiwyg/transaction";
import {finishTableCellEditing} from "./tableCellRichContext";
import {restoreTableVirtualizationDOM} from "./tableVirtualizationDOM";

export const TABLE_VIEWPORT_MIN_HEIGHT = 64;

const getStoredTableViewportHeight = (node: HTMLElement) => {
    const value = node.getAttribute(Constants.CUSTOM_SY_TABLE_VIEWPORT_HEIGHT);
    const match = value?.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) {
        return;
    }
    const height = Number(match[1]);
    return Number.isFinite(height) ? Math.max(TABLE_VIEWPORT_MIN_HEIGHT, height) : undefined;
};

export const applyTableViewportHeight = (node: HTMLElement) => {
    const height = getStoredTableViewportHeight(node);
    if (height === undefined) {
        return;
    }
    const viewport = node.firstElementChild as HTMLElement;
    if (!viewport?.querySelector(":scope > table")) {
        return;
    }
    const value = `${height}px`;
    if (node.getAttribute("custom-pinthead") === "true") {
        if (viewport.style.height !== value) {
            viewport.style.height = value;
        }
        if (viewport.style.maxHeight !== value) {
            viewport.style.maxHeight = value;
        }
    } else {
        if (viewport.style.height === value) {
            viewport.style.removeProperty("height");
        }
        if (viewport.style.maxHeight === value) {
            viewport.style.removeProperty("max-height");
        }
    }
};

export const startTableViewportResize = (protyle: IProtyle, cell: HTMLTableCellElement, table: HTMLTableElement,
                                        event: PointerEvent, preview: (height: number, x: number, y: number) => void,
                                        finished: () => void) => {
    const node = table?.closest<HTMLElement>('[data-type="NodeTable"]');
    const viewport = table?.parentElement;
    if (event.button !== 0 || protyle.disabled || !cell?.isConnected || !table?.isConnected || !node ||
        node.getAttribute("custom-pinthead") !== "true" || !viewport || !finishTableCellEditing(cell)) {
        return;
    }
    restoreTableVirtualizationDOM(table);
    applyTableViewportHeight(node);
    const oldHTML = node.outerHTML;
    const oldStyle = viewport.getAttribute("style");
    const startHeight = viewport.getBoundingClientRect().height;
    const startY = event.clientY;
    let height = startHeight;
    const controller = new AbortController();
    const {signal} = controller;
    const finish = (cancel: boolean) => {
        if (signal.aborted) {
            return;
        }
        controller.abort();
        if (cancel) {
            if (oldStyle === null) {
                viewport.removeAttribute("style");
            } else {
                viewport.setAttribute("style", oldStyle);
            }
        } else if (node.isConnected && height !== startHeight) {
            node.setAttribute(Constants.CUSTOM_SY_TABLE_VIEWPORT_HEIGHT, `${Math.round(height)}px`);
            if (node.outerHTML !== oldHTML) {
                updateTransaction(protyle, node, oldHTML);
            }
        }
        finished();
    };
    document.addEventListener("pointermove", move => {
        if (move.pointerId !== event.pointerId) {
            return;
        }
        if (protyle.disabled || !table.isConnected || !node.isConnected) {
            finish(true);
            return;
        }
        move.preventDefault();
        height = Math.max(TABLE_VIEWPORT_MIN_HEIGHT, Math.round(startHeight + move.clientY - startY));
        viewport.style.height = `${height}px`;
        viewport.style.maxHeight = `${height}px`;
        preview(Math.round(viewport.getBoundingClientRect().height), move.clientX, move.clientY);
    }, {signal, passive: false});
    const end = (up: PointerEvent) => {
        if (up.pointerId === event.pointerId) {
            finish(up.type === "pointercancel" || protyle.disabled || !table.isConnected || !node.isConnected);
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
