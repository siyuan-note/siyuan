const CURRENT_CLASS = "b3-menu__item--current";

export const getRelationKeyboardTarget = (list: HTMLElement, searching: boolean, key?: string) => {
    const items = Array.from(list.querySelectorAll<HTMLElement>('[data-type="setRelationCell"]')).filter(item =>
        !item.hasAttribute("disabled") && item.getClientRects().length > 0 &&
        (!searching || item.dataset.relationType !== "selected"));
    const current = list.querySelector<HTMLElement>("." + CURRENT_CLASS);
    const index = items.indexOf(current);
    let target = index >= 0 ? current : items.find(item => item.dataset.relationType !== "selected");
    if (key === "ArrowDown") {
        target = items[index < 0 ? 0 : (index + 1) % items.length];
    } else if (key === "ArrowUp") {
        target = items[index < 0 ? items.length - 1 : (index + items.length - 1) % items.length];
    }
    list.querySelectorAll("." + CURRENT_CLASS).forEach(item => item.classList.remove(CURRENT_CLASS));
    target?.classList.add(CURRENT_CLASS);
    if (target && (key === "ArrowDown" || key === "ArrowUp")) {
        target.scrollIntoView({block: "nearest"});
    }
    return target;
};
