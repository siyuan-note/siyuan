import {buildTableGrid, getVerticalTableCell} from "./table";
import {getCaretGoalX, isCaretAtVerticalBoundary} from "../wysiwyg/verticalCaret";
import {stripSemanticMarkersFromRangeText} from "./inlineElementMarker";
import {TABLE_CELL_RICH_ATTRIBUTE} from "./tableCellRichValue";

export const isTableCellCaretAtBoundary = (element: HTMLElement, range: Range, key: string) => {
    if (!range.collapsed || !element.contains(range.startContainer)) {
        return false;
    }
    const editables = element.matches("td, th") ? [element] :
        Array.from(element.querySelectorAll<HTMLElement>('[contenteditable="true"]'));
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
    return stripSemanticMarkersFromRangeText(remaining).replace(/\u200b/g, "") === "" &&
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

export const navigateToRichTableCell = (protyle: IProtyle, event: KeyboardEvent) => {
    if (protyle.disabled || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) ||
        !protyle.hint.element.classList.contains("fn__none") ||
        !protyle.toolbar.subElement.classList.contains("fn__none") ||
        protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select")) {
        return false;
    }
    const selection = getSelection();
    const range = selection.rangeCount ? selection.getRangeAt(0) : undefined;
    const element = range?.startContainer instanceof Element ? range.startContainer : range?.startContainer.parentElement;
    const cell = element?.closest<HTMLTableCellElement>("td, th");
    if (!cell || cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE) ||
        cell.closest(".protyle-wysiwyg") !== protyle.wysiwyg.element || !isTableCellCaretAtBoundary(cell, range, event.key)) {
        return false;
    }
    const next = getAdjacentRichTableCell(cell, event.key);
    if (!next?.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE)) {
        return false;
    }
    // 富内容预览不可直接编辑，边界导航需要显式进入其片段编辑器。
    const navigation = {key: event.key, goalX: getCaretGoalX(range)};
    event.preventDefault();
    event.stopPropagation();
    void import("../render/tableCellRichEditor").then(module => module.openTableCellRichEditor(protyle, next, navigation));
    return true;
};
