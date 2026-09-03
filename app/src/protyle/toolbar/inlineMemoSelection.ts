import {hasClosestByAttribute} from "../util/hasClosest";

export const getFirstSelectedInlineMemoContent = (range: Range) => {
    const startMemoElement = hasClosestByAttribute(range.startContainer, "data-type", "inline-memo");
    const memoElement = startMemoElement ||
        range.cloneContents().querySelector<HTMLElement>('[data-type~="inline-memo"]');
    if (!memoElement) {
        return;
    }
    return memoElement.getAttribute("data-inline-memo-content") ?? undefined;
};

export const setInlineMemoContentIfMissing = (element: HTMLElement, content?: string) => {
    if (content !== undefined && !element.hasAttribute("data-inline-memo-content")) {
        element.setAttribute("data-inline-memo-content", content);
    }
};
