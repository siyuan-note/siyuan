import {focusByOffset, focusByRange, getSelectionOffset} from "./selection";
import {mapTrackedTokenRange} from "./trackedRangeAnchor";

const getInlineCellSelectionText = (cell: Element) => {
    const clone = cell.cloneNode(true) as Element;
    // 与选区偏移一致，软换行和表情各占一个额外位置。
    clone.querySelectorAll("br, .emoji").forEach(element => element.before("\n"));
    return clone.textContent.split("");
};

export const captureInlineCellSelection = (cell: Element, range: Range) => {
    if (!cell.contains(range.startContainer) || !cell.contains(range.endContainer)) {
        return;
    }
    return {text: getInlineCellSelectionText(cell), ...getSelectionOffset(cell, undefined, range)};
};

export const restoreInlineCellSelection = (cell: Element, saved: ReturnType<typeof captureInlineCellSelection>) => {
    const mapped = mapTrackedTokenRange(saved.text, getInlineCellSelectionText(cell), saved,
        saved.start === saved.end, "before");
    return mapped && focusByOffset(cell, mapped.start, mapped.end);
};

const getCellEditables = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(
    '[data-type="NodeParagraph"] > [contenteditable]:not(.protyle-attr), ' +
    '[data-type="NodeHeading"] > [contenteditable]:not(.protyle-attr), ' +
    '[data-type="NodeCodeBlock"] .hljs > [contenteditable]:last-child'));

const captureRichCellRange = (editables: HTMLElement[], range: Range, backward = false) => {
    const startIndex = editables.findIndex(edit => edit.contains(range.startContainer));
    const endIndex = editables.findIndex(edit => edit.contains(range.endContainer));
    if (startIndex < 0 || endIndex < 0) {
        return;
    }
    const startRange = range.cloneRange();
    startRange.collapse(true);
    const endRange = range.cloneRange();
    endRange.collapse(false);
    return {
        startIndex, endIndex,
        start: getSelectionOffset(editables[startIndex], undefined, startRange).start,
        end: getSelectionOffset(editables[endIndex], undefined, endRange).start,
        backward,
    };
};

export const captureRichCellSelection = (cell: Element, selection: Selection, useCaret = false) => {
    const editables = getCellEditables(cell);
    // 代码高亮异步恢复选区时，临时定位节点才是编辑完成后的光标位置。
    const marker = useCaret ? editables.map(edit => edit.querySelector("wbr")).find(item => !!item) : undefined;
    if (!marker && !selection.rangeCount) {
        return;
    }
    const range = marker ? document.createRange() : selection.getRangeAt(0);
    if (marker) {
        range.setStartBefore(marker);
        range.collapse(true);
    }
    return captureRichCellRange(editables, range, !range.collapsed &&
        selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset);
};

export const captureRichCellSelectionAtPoint = (cell: Element, point: {x: number, y: number}) => {
    const range = document.caretRangeFromPoint(point.x, point.y);
    return range ? captureRichCellRange(getCellEditables(cell), range) : undefined;
};

export const restoreRichCellSelection = (root: Element, saved: ReturnType<typeof captureRichCellSelection>) => {
    if (!saved) {
        return false;
    }
    const editables = getCellEditables(root);
    const start = focusByOffset(editables[saved.startIndex], saved.start, saved.start, false);
    const end = focusByOffset(editables[saved.endIndex], saved.end, saved.end, false);
    if (!start || !end) {
        return false;
    }
    const range = document.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.startContainer, end.startOffset);
    focusByRange(range);
    if (saved.backward) {
        getSelection().setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset);
    }
    return true;
};
