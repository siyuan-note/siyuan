import {getAVColumnResizeWidth, updateAVTableColumnWidths} from "./columnWidth";
import {updateFrozenColumns} from "./frozenColumns";
import {getAVData, invalidateAVTableRowHeights} from "./virtualScroll";
import {prepareAVColumnWindow} from "./columnWindow";

export type TRelatedAVColumnWidths = Record<string, Record<string, string>>;

export const applyRelatedAVColumnWidths = (element: HTMLElement, widths: Record<string, string>, data = getAVData(element)) => {
    if (!data || data.viewType !== "table" || !widths) return;
    prepareAVColumnWindow(element);
    // 同步分组缓存，保证虚拟滚动和展开分组使用当前面板的列宽。
    updateAVTableColumnWidths(data.view as IAVTable, widths);
    element.querySelectorAll<HTMLElement>(".av__row [data-col-id], .av__row--footer [data-col-id]").forEach(cell => {
        const width = widths[cell.dataset.colId];
        if (width) cell.style.width = width;
    });
    updateFrozenColumns(element);
    invalidateAVTableRowHeights(element);
};

export const startRelatedAVColumnResize = (event: PointerEvent, element: HTMLElement,
                                          widths: TRelatedAVColumnWidths, canResize: () => boolean) => {
    const handle = (event.target as HTMLElement).closest<HTMLElement>(".av__widthdrag");
    const cell = handle?.parentElement;
    const data = getAVData(element);
    if (!handle || !cell?.dataset.colId || event.button !== 0 || !canResize() || data?.viewType !== "table") return;
    event.preventDefault();
    event.stopPropagation();
    const viewID = data.viewID;
    const columnID = cell.dataset.colId;
    const initialX = event.clientX;
    const rect = cell.getBoundingClientRect();
    const initialWidth = parseFloat(cell.style.width) || rect.width;
    const scale = rect.width / initialWidth || 1;
    const header = cell.closest(".av__row--header");
    const cells = Array.from(header?.querySelectorAll<HTMLElement>(".av__cell--header") || []);
    const previousCell = cells[cells.indexOf(cell) - 1];
    const previousWidth = previousCell ? parseFloat(previousCell.style.width) || previousCell.getBoundingClientRect().width : undefined;
    let finished = false;
    const finish = (end?: Event) => {
        if (end && "pointerId" in end && end.pointerId !== event.pointerId) return;
        if (finished) return;
        finished = true;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        handle.removeEventListener("lostpointercapture", finish);
        window.removeEventListener("blur", finish);
        handle.classList.remove("av__widthdrag--active");
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (!canResize() || !element.isConnected || getAVData(element)?.viewID !== viewID) {
            finish();
            return;
        }
        const width = getAVColumnResizeWidth(initialWidth + (next.clientX - initialX) / scale, previousWidth).width;
        widths[viewID] ||= {};
        widths[viewID][columnID] = `${width}px`;
        applyRelatedAVColumnWidths(element, widths[viewID]);
        next.preventDefault();
    };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("av__widthdrag--active");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
    handle.addEventListener("lostpointercapture", finish);
    window.addEventListener("blur", finish);
    return finish;
};
