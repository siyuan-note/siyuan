import {Constants} from "../../constants";
import {transaction} from "../wysiwyg/transaction";
import {finishTableCellEditing} from "./tableCellRichContext";

const TABLE_VIEWPORT_MIN_HEIGHT = 64;
const heightAttribute = Constants.CUSTOM_SY_TABLE_VIEWPORT_HEIGHT;
const heightProperty = "--b3-table-viewport-height";
const previewProperty = "--b3-table-viewport-preview-height";

const getStoredTableViewportHeight = (node: HTMLElement) => {
    const value = node.getAttribute(heightAttribute);
    const match = value?.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) {
        return;
    }
    const height = Number(match[1]);
    return Number.isFinite(height) ? Math.max(TABLE_VIEWPORT_MIN_HEIGHT, height) : undefined;
};

export const applyTableViewportHeight = (node: HTMLElement, viewport: HTMLElement) => {
    const height = getStoredTableViewportHeight(node);
    const value = height === undefined ? "" : `${height}px`;
    if (viewport.style.getPropertyValue(heightProperty) !== value) {
        viewport.style.setProperty(heightProperty, value);
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
    const previous = node.getAttribute(heightAttribute);
    const startHeight = viewport.offsetHeight;
    const startY = event.clientY;
    const scale = viewport.getBoundingClientRect().height / startHeight || 1;
    const maxHeight = startHeight + viewport.scrollHeight - viewport.clientHeight;
    const minHeight = Math.min(maxHeight, Math.max(TABLE_VIEWPORT_MIN_HEIGHT, (table.tHead?.offsetHeight || 0) + 24));
    let height = startHeight;
    const controller = new AbortController();
    const {signal} = controller;
    const canResize = () => !protyle.disabled && viewport.contains(table) && node.isConnected &&
        node.getAttribute("custom-pinthead") === "true" && node.getAttribute(heightAttribute) === previous;
    const finish = (cancel: boolean) => {
        if (signal.aborted) {
            return;
        }
        controller.abort();
        viewport.style.removeProperty(previewProperty);
        const next = `${height}px`;
        if (!cancel && height !== startHeight && next !== previous) {
            node.setAttribute(heightAttribute, next);
            transaction(protyle, [{action: "setAttrs", id: node.dataset.nodeId,
                data: JSON.stringify({[heightAttribute]: next})}], [{action: "setAttrs", id: node.dataset.nodeId,
                data: JSON.stringify({[heightAttribute]: previous || ""})}]);
        }
        applyTableViewportHeight(node, viewport);
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
        viewport.style.setProperty(previewProperty, height === startHeight ? "" : `${height}px`);
        preview(viewport.offsetHeight, move.clientX, move.clientY);
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
