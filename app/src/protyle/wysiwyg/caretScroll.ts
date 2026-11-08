import {getVerticalCaretRect} from "./verticalCaret";
import {getTableCellRichContext} from "../util/tableCellRichContext";
import {isAtomicVerticalNavigationTarget, isAtomicVerticalNavigationRange} from "./verticalNavigationState";
import {
    getCaretOverflowDirection,
    getCaretScrollDelta,
    type ICaretScrollGeometry,
    type TCaretVerticalDirection
} from "./caretScrollCore";

const pendingFrames = new WeakMap<HTMLElement, number>();

const getLineHeight = (element: Element) => {
    const style = getComputedStyle(element);
    const lineHeight = parseFloat(style.lineHeight);
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
        return lineHeight;
    }
    const fontSize = parseFloat(style.fontSize);
    return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.625 : window.siyuan.config.editor.fontSize * 1.625;
};

const getCaretScrollGeometry = (protyle: IProtyle): ICaretScrollGeometry | undefined => {
    const owner = getTableCellRichContext(protyle)?.owner || protyle;
    if (protyle.disabled || owner.disabled || !protyle.element.isConnected || !owner.element.isConnected) {
        return;
    }
    const selection = window.getSelection();
    if (!selection?.focusNode || !protyle.wysiwyg.element.contains(selection.focusNode)) {
        return;
    }
    const focusElement = selection.focusNode.nodeType === Node.ELEMENT_NODE ?
        selection.focusNode as Element : selection.focusNode.parentElement;
    if (focusElement?.closest(".protyle-wysiwyg") !== protyle.wysiwyg.element ||
        isAtomicVerticalNavigationTarget(focusElement)) {
        return;
    }
    const editableElement = focusElement?.closest("[contenteditable=\"true\"]");
    if (!editableElement || !protyle.wysiwyg.element.contains(editableElement)) {
        return;
    }
    const range = document.createRange();
    try {
        range.setStart(selection.focusNode, selection.focusOffset);
    } catch {
        return;
    }
    range.collapse(true);
    if (isAtomicVerticalNavigationRange(range)) {
        return;
    }
    const caretPosition = getVerticalCaretRect(editableElement, range);
    if (!caretPosition) {
        return;
    }
    const lineHeight = getLineHeight(editableElement);
    const viewportRect = owner.contentElement.getBoundingClientRect();
    return {
        caretTop: caretPosition.top,
        caretHeight: caretPosition.height,
        viewportTop: viewportRect.top,
        viewportHeight: viewportRect.height,
        lineHeight,
        surroundingLines: window.siyuan.config.editor.cursorSurroundingLines,
    };
};

const scrollCaretIntoMargin = (protyle: IProtyle, direction: TCaretVerticalDirection) => {
    const geometry = getCaretScrollGeometry(protyle);
    if (!geometry) {
        return;
    }
    const delta = getCaretScrollDelta(geometry, direction);
    if (delta !== 0) {
        const owner = getTableCellRichContext(protyle)?.owner || protyle;
        owner.contentElement.scrollTop += delta;
    }
};

export const scheduleCaretScroll = (protyle: IProtyle, direction: TCaretVerticalDirection) => {
    if (window.siyuan.config.editor.cursorSurroundingLines <= 0) {
        return;
    }
    const owner = getTableCellRichContext(protyle)?.owner || protyle;
    const pendingFrame = pendingFrames.get(owner.contentElement);
    if (pendingFrame !== undefined) {
        cancelAnimationFrame(pendingFrame);
    }
    pendingFrames.set(owner.contentElement, requestAnimationFrame(() => {
        pendingFrames.delete(owner.contentElement);
        if (protyle.element.isConnected) {
            scrollCaretIntoMargin(protyle, direction);
        }
    }));
};

export const scheduleOffscreenCaretScroll = (protyle: IProtyle) => {
    if (window.siyuan.config.editor.cursorSurroundingLines <= 0) {
        return;
    }
    const geometry = getCaretScrollGeometry(protyle);
    if (!geometry) {
        return;
    }
    const direction = getCaretOverflowDirection(geometry);
    if (direction) {
        scheduleCaretScroll(protyle, direction);
    }
};
