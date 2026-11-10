import {ensureAVTableAdjacentRow, ensureAVTableRow, getAVData} from "./virtualScroll";
import {ensureAVColumnWindow} from "./columnWindow";
import {resolveAVSelectedCell} from "./selectionState";
import {setAVCellAnchor} from "./rangeSelect";
import {isTableLikeView} from "./viewType";

export const isAVContinuousInputKey = (event: KeyboardEvent, allowRepeat = false) => event.key === "Enter" &&
    !event.isComposing && (!event.repeat || allowRepeat) && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;

export const prepareAVContinuousInput = (protyle: IProtyle, block: HTMLElement, cells: HTMLElement[],
                                         open: (cell: HTMLElement) => void): (() => void) | undefined => {
    const enabled = () => !window.siyuan.config.readonly && !window.siyuan.isPublish && !protyle.disabled &&
        !protyle.options?.history?.created && !protyle.options?.history?.snapshot;
    if (!enabled() || cells.length !== 1 || !isTableLikeView(block.dataset.avType) ||
        !block.isConnected || !protyle.element.isConnected || cells[0].closest(".custom-attr") ||
        (cells[0].dataset.dtype === "block" && cells[0].dataset.detached !== "true")) {
        return;
    }
    const row = cells[0].closest<HTMLElement>(".av__row[data-id]");
    const body = row?.closest<HTMLElement>(".av__body");
    const colID = cells[0].dataset.colId;
    if (!row || !body || !colID || body.closest(".av") !== block) {
        return;
    }
    // 提交可能改变排序和过滤结果，先记录下一条可见记录，完成后按稳定标识重新解析。
    const next = ensureAVTableAdjacentRow(row, "next");
    const point = next?.dataset.id ? {groupID: body.dataset.groupId || "", rowID: next.dataset.id, colID} : undefined;
    const viewID = getAVData(block)?.viewID;
    const avID = block.dataset.avId;
    const active = document.activeElement;
    return () => {
        if (!point || !enabled() || !block.isConnected || !protyle.element.isConnected ||
            block.dataset.avId !== avID || getAVData(block)?.viewID !== viewID ||
            document.querySelector(".av__mask, [data-av-location-editor]") ||
            (document.activeElement !== active && document.activeElement !== document.body &&
                document.activeElement !== protyle.wysiwyg.element && !block.contains(document.activeElement))) {
            return;
        }
        const data = getAVData(block);
        const target = data && resolveAVSelectedCell(data, point);
        if (!target || target.column.hidden || target.column.type !== cells[0].dataset.dtype) {
            return;
        }
        const group = Array.from(block.querySelectorAll<HTMLElement>(".av__body"))
            .find(item => item.closest(".av") === block && (item.dataset.groupId || "") === point.groupID);
        if (!group || group.classList.contains("fn__none")) return;
        ensureAVTableRow(block, point.rowID, point.groupID);
        ensureAVColumnWindow(block, colID, point.rowID, point.groupID);
        const currentRow = Array.from(group.querySelectorAll<HTMLElement>(".av__row[data-id]"))
            .find(item => item.dataset.id === point.rowID);
        const cell = currentRow && Array.from(currentRow.querySelectorAll<HTMLElement>(".av__cell[data-col-id]"))
            .find(item => item.dataset.colId === colID);
        if (cell && (cell.dataset.dtype !== "block" || cell.dataset.detached === "true") && setAVCellAnchor(block, cell)) open(cell);
    };
};
