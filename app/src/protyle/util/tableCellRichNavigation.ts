import {buildTableGrid, getVerticalTableCell} from "./table";
import {isCaretAtVerticalBoundary} from "../wysiwyg/verticalCaret";

export const isTableCellCaretAtBoundary = (element: HTMLElement, range: Range, key: string) => {
    if (!range.collapsed || !element.contains(range.startContainer)) {
        return false;
    }
    const editables = Array.from(element.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
    const backward = key === "ArrowLeft" || key === "ArrowUp";
    const editable = backward ? editables[0] : editables[editables.length - 1];
    if (!editable?.contains(range.startContainer)) {
        return false;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
        return isCaretAtVerticalBoundary(editable, range, backward ? "up" : "down");
    }
    const remaining = document.createRange();
    remaining.selectNodeContents(editable);
    if (backward) {
        remaining.setEnd(range.startContainer, range.startOffset);
    } else {
        remaining.setStart(range.startContainer, range.startOffset);
    }
    return remaining.toString().replace(/\u200b/g, "") === "" &&
        !remaining.cloneContents().querySelector("br, img, [data-type='inline-math']");
};

export const getAdjacentRichTableCell = (cell: HTMLTableCellElement, key: string) => {
    if (key === "ArrowUp" || key === "ArrowDown") {
        return getVerticalTableCell(cell, key === "ArrowUp" ? "up" : "down");
    }
    const table = cell.closest("table");
    if (!table) {
        return;
    }
    const {cellInfos} = buildTableGrid(table);
    const index = cellInfos.findIndex(info => info.cell === cell);
    return index < 0 ? undefined : cellInfos[index + (key === "ArrowLeft" ? -1 : 1)]?.cell;
};
