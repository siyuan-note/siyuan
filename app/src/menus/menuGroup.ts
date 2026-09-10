export const updateMenuItemGroupClasses = (itemsElement: Element) => {
    const itemElements = Array.from(itemsElement.children).filter((element) =>
        element.classList.contains("b3-menu__item")) as HTMLElement[];
    itemElements.forEach((element) => {
        element.classList.remove("b3-menu__item--group-first", "b3-menu__item--group-last");
    });
    if (itemElements.length === 0) {
        itemsElement.classList.remove("b3-menu__items--menu");
        return;
    }
    itemsElement.classList.add("b3-menu__items--menu");
    let groupElements: HTMLElement[] = [];
    const updateGroup = () => {
        if (groupElements.length === 0) {
            return;
        }
        groupElements[0].classList.add("b3-menu__item--group-first");
        groupElements[groupElements.length - 1].classList.add("b3-menu__item--group-last");
        groupElements = [];
    };
    Array.from(itemsElement.children).forEach((element: HTMLElement) => {
        if (element.classList.contains("fn__none")) {
            return;
        }
        if (element.classList.contains("b3-menu__separator") || element.classList.contains("b3-menu__title")) {
            updateGroup();
        } else if (element.classList.contains("b3-menu__item")) {
            groupElements.push(element);
        }
    });
    updateGroup();
};
