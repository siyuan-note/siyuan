import {hasClosestBlock} from "../util/hasClosest";

export const recordReplacementUndo = (event: InputEvent, element: HTMLElement,
                                      lastHTMLs: {[key: string]: string}) => {
    if (event.defaultPrevented || event.inputType !== "insertReplacementText" || event.isComposing) {
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
    // 原生纠错不经过键盘输入，在浏览器替换文本前保存完整块，供撤销恢复内容及格式。
    lastHTMLs[blockElement.getAttribute("data-node-id")] = blockElement.outerHTML;
};
