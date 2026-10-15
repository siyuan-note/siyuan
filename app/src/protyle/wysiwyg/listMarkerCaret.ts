import {getContenteditableElement} from "./getBlock";
import {isCommittedTextInput} from "./compositionInput";

const getMarkerItem = (root: HTMLElement, node: Node, offset: number) => {
    if (!node || !root.contains(node)) {
        return;
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const marker = element?.closest(".protyle-action");
    if (marker?.parentElement?.getAttribute("data-type") === "NodeListItem") {
        return marker.parentElement;
    }
    // 原生光标也可能落在列表项容器中、序号的前后，而非序号文本内部。
    if (element === node && element.getAttribute("data-type") === "NodeListItem") {
        const action = element.querySelector(":scope > .protyle-action");
        if (action && offset <= Array.prototype.indexOf.call(element.childNodes, action) + 1) {
            return element as HTMLElement;
        }
    }
};

export const bindListMarkerCaret = (root: HTMLElement, canPlaceCaret: () => boolean) => {
    const ownerDocument = root.ownerDocument;
    let composing = false;
    const repair = () => {
        const selection = ownerDocument.getSelection();
        if (!canPlaceCaret() || !root.contains(ownerDocument.activeElement) ||
            !selection?.isCollapsed || !selection.rangeCount) {
            return false;
        }
        const item = getMarkerItem(root, selection.anchorNode, selection.anchorOffset);
        const editable = item && getContenteditableElement(item) as HTMLElement;
        if (!editable?.isContentEditable || !root.contains(editable)) {
            return false;
        }
        const range = ownerDocument.createRange();
        range.selectNodeContents(editable);
        range.collapse(true);
        editable.focus({preventScroll: true});
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    };
    const selectionChange = () => {
        if (!composing) {
            repair();
        }
    };
    const beforeInput = (event: InputEvent) => {
        if (!canPlaceCaret()) {
            return;
        }
        const invalidTarget = event.getTargetRanges().some(range => {
            const item = getMarkerItem(root, range.startContainer, range.startOffset);
            return item && item === getMarkerItem(root, range.endContainer, range.endOffset);
        });
        const repaired = !composing && repair();
        // 输入事件可能仍保存校正前的目标位置，取消这一笔，避免原生编辑删除或改写序号。
        if ((invalidTarget || repaired) && event.cancelable) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    const compositionStart = () => {
        repair();
        composing = true;
    };
    const compositionEnd = () => {
        composing = false;
        repair();
    };
    const input = (event: InputEvent) => {
        if (isCommittedTextInput(event)) {
            composing = false;
        }
    };
    ownerDocument.addEventListener("selectionchange", selectionChange);
    root.addEventListener("beforeinput", beforeInput, true);
    root.addEventListener("compositionstart", compositionStart, true);
    root.addEventListener("compositionend", compositionEnd);
    root.addEventListener("input", input);
    return () => {
        ownerDocument.removeEventListener("selectionchange", selectionChange);
        root.removeEventListener("beforeinput", beforeInput, true);
        root.removeEventListener("compositionstart", compositionStart, true);
        root.removeEventListener("compositionend", compositionEnd);
        root.removeEventListener("input", input);
    };
};
