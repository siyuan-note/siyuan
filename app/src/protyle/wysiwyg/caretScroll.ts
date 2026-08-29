import {getSelectionPosition} from "../util/selection";
import {getCaretScrollDelta, type TCaretVerticalDirection} from "./caretScrollCore";

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

const scrollCaretIntoMargin = (protyle: IProtyle, direction: TCaretVerticalDirection) => {
    const selection = window.getSelection();
    if (!selection?.focusNode || !protyle.wysiwyg.element.contains(selection.focusNode)) {
        return;
    }
    const focusElement = selection.focusNode.nodeType === Node.ELEMENT_NODE ?
        selection.focusNode as Element : selection.focusNode.parentElement;
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
    const caretPosition = getSelectionPosition(editableElement, range);
    if (!Number.isFinite(caretPosition.top) || caretPosition.left === 0 && caretPosition.top === 0) {
        return;
    }
    const lineHeight = getLineHeight(editableElement);
    const viewportRect = protyle.contentElement.getBoundingClientRect();
    const delta = getCaretScrollDelta({
        caretTop: caretPosition.top,
        caretHeight: lineHeight,
        viewportTop: viewportRect.top,
        viewportHeight: viewportRect.height,
        lineHeight,
        surroundingLines: window.siyuan.config.editor.cursorSurroundingLines,
    }, direction);
    if (delta !== 0) {
        protyle.contentElement.scrollTop += delta;
    }
};

export const scheduleCaretScroll = (protyle: IProtyle, direction: TCaretVerticalDirection) => {
    if (window.siyuan.config.editor.cursorSurroundingLines <= 0) {
        return;
    }
    const pendingFrame = pendingFrames.get(protyle.contentElement);
    if (pendingFrame !== undefined) {
        cancelAnimationFrame(pendingFrame);
    }
    pendingFrames.set(protyle.contentElement, requestAnimationFrame(() => {
        pendingFrames.delete(protyle.contentElement);
        if (protyle.element.isConnected) {
            scrollCaretIntoMargin(protyle, direction);
        }
    }));
};
