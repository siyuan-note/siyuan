export const setMenuInputCurrent = (menuElement: Element, inputElement: Element) => {
    const itemsElement = inputElement.closest(".b3-menu__items");
    const inputItemElement = Array.from(itemsElement?.children || []).find((item) => item.contains(inputElement));
    if (!inputItemElement || !menuElement.contains(inputItemElement)) {
        return false;
    }
    menuElement.querySelectorAll(".b3-menu__item--current").forEach((item) => {
        item.classList.remove("b3-menu__item--current");
    });
    inputItemElement.classList.add("b3-menu__item--current");
    return true;
};
