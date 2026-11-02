import {hasClosestBlock} from "../util/hasClosest";

export const recordNativeInputUndo = (event: InputEvent, element: HTMLElement,
                                     lastHTMLs: {[key: string]: string}, composing = false) => {
    const replacement = event.inputType === "insertReplacementText";
    if (event.defaultPrevented || event.isComposing ||
        (!replacement && (event.inputType !== "insertText" || composing))) {
        return;
    }
    const selection = element.ownerDocument.getSelection();
    const range = event.getTargetRanges()[0] ||
        (selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined);
    if (!range || !element.contains(range.startContainer) || !element.contains(range.endContainer)) {
        return;
    }
    const blockElement = hasClosestBlock(range.startContainer);
    if (!blockElement || blockElement !== hasClosestBlock(range.endContainer)) {
        return;
    }
    const id = blockElement.getAttribute("data-node-id");
    // 原生纠错和直接提交的输入法文本可能没有键盘或组合开始事件，需在浏览器修改前保存完整块。
    if (replacement || !lastHTMLs[id]) {
        lastHTMLs[id] = blockElement.outerHTML;
    }
};
