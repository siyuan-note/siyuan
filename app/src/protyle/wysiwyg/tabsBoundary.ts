import {visibleTabsSelectionHTML} from "../render/tabsVisibility";

export const isTabTextBoundary = (range: Range, backward: boolean) => {
    if (!range.collapsed) {
        return false;
    }
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE ?
        range.startContainer as Element : range.startContainer.parentElement;
    if (element.closest(".tab-item-title")) {
        return false;
    }
    const content = element.closest(".tab-item-content");
    if (!content) {
        return false;
    }
    const side = document.createRange();
    side.selectNodeContents(content);
    if (backward) {
        side.setEnd(range.startContainer, range.startOffset);
    } else {
        side.setStart(range.endContainer, range.endOffset);
    }
    const fragment = document.createElement("div");
    fragment.append(side.cloneContents());
    fragment.innerHTML = visibleTabsSelectionHTML(fragment.innerHTML);
    fragment.querySelectorAll(".protyle-attr, .tab-item-info, .protyle-action").forEach(item => item.remove());
    // 空块仍占据正文位置，只有光标所在的祖先块不构成可删除的相邻内容。
    const ancestorIDs = new Set<string>();
    for (let current = element; current && current !== content; current = current.parentElement) {
        if (current.hasAttribute("data-node-id")) {
            ancestorIDs.add(current.getAttribute("data-node-id"));
        }
    }
    if (Array.from(fragment.querySelectorAll("[data-node-id]")).some(item =>
        !ancestorIDs.has(item.getAttribute("data-node-id")))) {
        return false;
    }
    return fragment.textContent.replace(/\u200b/g, "") === "" &&
        !fragment.querySelector("img, video, audio, iframe, .render-node, .av, .hr");
};
