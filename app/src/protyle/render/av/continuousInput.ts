import {ensureAVTableAdjacentRow, ensureAVTableRow, getAVData} from "./virtualScroll";
import {ensureAVColumnWindow} from "./columnWindow";
import {getAVCellSelection, IAVCellPoint, IAVSelectedCell, resolveAVSelectedCell, restoreAVCellSelection} from "./selectionState";
import {setAVCellAnchor} from "./rangeSelect";
import {isTableLikeView} from "./viewType";
import {hasAVCapability, isAVTextType} from "./capabilities";

export const isAVContinuousInputKey = (event: KeyboardEvent, allowRepeat = false) => event.key === "Enter" &&
    !event.isComposing && event.keyCode !== 229 && (!event.repeat || allowRepeat) &&
    !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;

const supportsRangeInput = (cell: IAVSelectedCell) => {
    const type = cell.column.type;
    return hasAVCapability(type, "editable") && (isAVTextType(type) || type === "number" || type === "select") &&
        (type !== "block" || cell.cell.value.isDetached === true);
};
const samePoint = (a: IAVCellPoint, b: IAVCellPoint) => a.groupID === b.groupID && a.rowID === b.rowID && a.colID === b.colID;

const getInputCell = (block: HTMLElement, point: IAVCellPoint) => {
    ensureAVTableRow(block, point.rowID, point.groupID);
    ensureAVColumnWindow(block, point.colID, point.rowID, point.groupID);
    const group = Array.from(block.querySelectorAll<HTMLElement>(".av__body"))
        .find(item => item.closest(".av") === block && (item.dataset.groupId || "") === point.groupID);
    if (!group || group.classList.contains("fn__none")) return;
    const row = Array.from(group.querySelectorAll<HTMLElement>(".av__row[data-id]"))
        .find(item => item.dataset.id === point.rowID);
    return row && Array.from(row.querySelectorAll<HTMLElement>(".av__cell[data-col-id]"))
        .find(item => item.dataset.colId === point.colID);
};

export const openAVRangeInput = (protyle: IProtyle, block: HTMLElement, open: (cell: HTMLElement) => void) => {
    const selection = getAVCellSelection(block);
    if (!selection || selection.cells.length < 2 || !isTableLikeView(block.dataset.avType) ||
        !block.isConnected || !protyle.element.isConnected ||
        protyle.disabled || window.siyuan.config.readonly || window.siyuan.isPublish ||
        protyle.options?.history?.created || protyle.options?.history?.snapshot ||
        document.querySelector(".av__mask, .av__panel, [data-av-location-editor]")) return false;
    const point = selection.input || selection.cells.find(supportsRangeInput);
    const data = getAVData(block);
    const target = point && data && resolveAVSelectedCell(data, point);
    const cell = target && supportsRangeInput(target) && getInputCell(block, target);
    if (cell && cell.dataset.dtype === target.column.type && getAVCellSelection(block) === selection) {
        // 选区边界用于批量操作，录入位置独立记录，保存只提交当前单元格。
        selection.input = {groupID: target.groupID, rowID: target.rowID, colID: target.colID};
        restoreAVCellSelection(block);
        open(cell);
    }
    return true;
};

export const prepareAVContinuousInput = (protyle: IProtyle, block: HTMLElement, cells: HTMLElement[],
                                         open: (cell: HTMLElement) => void, rangeOnly = false): (() => void) | undefined => {
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
    const source = {groupID: body.dataset.groupId || "", rowID: row.dataset.id, colID};
    const selection = getAVCellSelection(block);
    const range = selection?.input;
    if (range && !samePoint(range, source) || rangeOnly && !range) return;
    const rangeIndex = range ? selection.cells.findIndex(cell => samePoint(cell, source)) : -1;
    if (range && rangeIndex < 0) return;
    // 提交可能改变排序和过滤结果，先记录下一条可见记录，完成后按稳定标识重新解析。
    let point: IAVCellPoint;
    let targetType = cells[0].dataset.dtype;
    if (range) {
        const nextCell = selection.cells.slice(rangeIndex + 1).find(supportsRangeInput);
        if (nextCell) {
            point = {groupID: nextCell.groupID, rowID: nextCell.rowID, colID: nextCell.colID};
            targetType = nextCell.column.type;
        }
    } else {
        const next = ensureAVTableAdjacentRow(row, "next");
        if (next?.dataset.id) point = {groupID: source.groupID, rowID: next.dataset.id, colID};
    }
    const viewID = getAVData(block)?.viewID;
    const avID = block.dataset.avId;
    const active = document.activeElement;
    return () => {
        if (!point || !enabled() || !block.isConnected || !protyle.element.isConnected ||
            block.dataset.avId !== avID || getAVData(block)?.viewID !== viewID ||
            document.querySelector(".av__mask, .av__panel, [data-av-location-editor]") ||
            getAVCellSelection(block) !== selection ||
            (range && (!selection.input || !samePoint(selection.input, source))) ||
            (document.activeElement !== active && document.activeElement !== document.body &&
                document.activeElement !== protyle.wysiwyg.element && !block.contains(document.activeElement))) {
            return;
        }
        const data = getAVData(block);
        const target = data && resolveAVSelectedCell(data, point);
        if (!target || target.column.hidden || target.column.type !== targetType || range && !supportsRangeInput(target)) {
            return;
        }
        const cell = getInputCell(block, point);
        if (!cell || cell.dataset.dtype !== target.column.type ||
            cell.dataset.dtype === "block" && cell.dataset.detached !== "true" ||
            getAVCellSelection(block) !== selection) return;
        if (range) {
            selection.input = point;
            restoreAVCellSelection(block);
            open(cell);
        } else if (setAVCellAnchor(block, cell)) open(cell);
    };
};
