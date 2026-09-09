import {isHiddenTabContent} from "../render/tabsVisibility";

// 点击空正文时，浏览器可能保留隐藏页签中的选区，先将失效的光标放到当前编辑区域。
export const repairHiddenTabSelection = (root: HTMLElement, target: Element) => {
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    const anchorElement = anchor instanceof Element ? anchor : anchor?.parentElement;
    const editable = target.closest<HTMLElement>('[contenteditable="true"]');
    if (!anchor || !root.contains(anchor) || !isHiddenTabContent(anchorElement) ||
        !editable || !root.contains(editable) || !editable.closest(".tab-item-content") ||
        isHiddenTabContent(editable) || target.closest('[contenteditable="false"]') ||
        editable.textContent !== "" || editable.querySelector("[data-node-id], img, input, video, audio, iframe")) {
        return;
    }
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
};
