const focusClass = "b3-list-item--focus";

export const getVisibleFileTreeItems = (root: HTMLElement): Element[] => {
    return Array.from(root.querySelectorAll("li.b3-list-item")).filter((item) => {
        if (!item.getClientRects().length) {
            return false;
        }
        // 折叠动画中的子列表仍在 DOM 中，通过父节点的展开状态排除这些行。
        let parent = item.parentElement;
        while (parent && parent !== root) {
            const owner = parent.previousElementSibling;
            if (parent.tagName === "UL" && owner?.matches("li.b3-list-item") &&
                !owner.querySelector(".b3-list-item__arrow--open")) {
                return false;
            }
            parent = parent.parentElement;
        }
        return true;
    });
};

export const selectFileTreeRange = (root: HTMLElement, anchor: Element, target: Element): Element => {
    const items = getVisibleFileTreeItems(root);
    const end = items.indexOf(target);
    if (end < 0) {
        return items.includes(anchor) ? anchor : null;
    }
    if (!items.includes(anchor)) {
        anchor = items.find((item) => item.classList.contains(focusClass)) || target;
    }
    const start = items.indexOf(anchor);
    root.querySelectorAll(`.${focusClass}`).forEach((item) => item.classList.remove(focusClass));
    items.slice(Math.min(start, end), Math.max(start, end) + 1).forEach((item) => {
        item.classList.add(focusClass);
    });
    return anchor;
};
