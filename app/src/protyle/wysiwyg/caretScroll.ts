import {getVerticalCaretRect} from "./verticalCaret";
import {isAtomicVerticalNavigationTarget} from "./verticalNavigationState";
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
    if (protyle.disabled || !protyle.element.isConnected) {
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
    const caretPosition = getVerticalCaretRect(editableElement, range);
    if (!caretPosition) {
        return;
    }
    const lineHeight = getLineHeight(editableElement);
    const viewportRect = protyle.contentElement.getBoundingClientRect();
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
