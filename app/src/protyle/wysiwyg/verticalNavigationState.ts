export const VERTICAL_NAVIGATION_ATOMIC_CLASS = "protyle-wysiwyg--navigation";

export const isAtomicVerticalNavigationTarget = (element: Element) =>
    !!element.closest(`.${VERTICAL_NAVIGATION_ATOMIC_CLASS}`);

export const getAtomicVerticalNavigationOwner = (range: Range): Element | undefined => {
    if (!range.collapsed || range.startContainer.nodeType !== 1) {
        return;
    }
    const element = range.startContainer as Element;
    if (range.startOffset === 0 && element.classList.contains(VERTICAL_NAVIGATION_ATOMIC_CLASS)) {
        return element;
    }
    const child = element.childNodes?.[range.startOffset];
    if (child?.nodeType === 1 && (child as Element).classList.contains("custom-block") &&
        (child as Element).classList.contains(VERTICAL_NAVIGATION_ATOMIC_CLASS)) {
        return child as Element;
    }
};

export const isAtomicVerticalNavigationRange = (range: Range) => !!getAtomicVerticalNavigationOwner(range);

export const shouldKeepAtomicVerticalNavigationTarget = (owner: Element, range: Range) => {
    if (!range.collapsed) {
        return false;
    }
    if (getAtomicVerticalNavigationOwner(range) === owner) {
        return true;
    }
    if (owner.getAttribute("fold") === "1") {
        return range.startContainer === owner && range.startOffset === 0;
    }
    return range.startContainer === owner || owner.contains(range.startContainer);
};
