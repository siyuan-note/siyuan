export const VERTICAL_NAVIGATION_ATOMIC_CLASS = "protyle-wysiwyg--navigation";

export const isAtomicVerticalNavigationTarget = (element: Element) =>
    !!element.closest(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`);

export const isAtomicVerticalNavigationRange = (range: Range) =>
    range.collapsed && range.startOffset === 0 && range.startContainer.nodeType === 1 &&
    (range.startContainer as Element).classList.contains(VERTICAL_NAVIGATION_ATOMIC_CLASS);

export const shouldKeepAtomicVerticalNavigationTarget = (owner: Element, range: Range) => {
    if (!range.collapsed) {
        return false;
    }
    if (owner.getAttribute("fold") === "1") {
        return range.startContainer === owner && range.startOffset === 0;
    }
    return range.startContainer === owner || owner.contains(range.startContainer);
};
