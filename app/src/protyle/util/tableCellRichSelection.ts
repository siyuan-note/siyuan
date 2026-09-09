import {focusByOffset, focusByRange, getSelectionOffset} from "./selection";

const getCellEditables = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>(
    '[data-type="NodeParagraph"] > [contenteditable], [data-type="NodeHeading"] > [contenteditable], ' +
    '[data-type="NodeCodeBlock"] .hljs > [contenteditable]'));

export const captureRichCellSelection = (cell: Element, selection: Selection) => {
    if (!selection.rangeCount) {
        return;
    }
    const range = selection.getRangeAt(0);
    const editables = getCellEditables(cell);
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
        backward: !range.collapsed && selection.anchorNode === range.endContainer && selection.anchorOffset === range.endOffset,
    };
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
