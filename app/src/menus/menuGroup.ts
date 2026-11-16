export const updateMenuGroupsOnMutation = (records: MutationRecord[]) => {
    const containers = new Set<Element>();
    records.forEach((record) => {
        const target = record.target as Element;
        if (record.type === "childList" && target.classList?.contains("b3-menu__items")) {
            containers.add(target);
        }
    });
    containers.forEach(updateMenuItemGroupClasses);
};

export const updateMenuItemGroupClasses = (itemsElement: Element) => {
    const itemElements = Array.from(itemsElement.children).filter((element) =>
        element.classList.contains("b3-menu__item")) as HTMLElement[];
    // 仅写入实际变化，避免与内嵌控件的属性观察器互相触发。
    const setClass = (element: Element, name: string, enabled: boolean) => {
        if (element.classList.contains(name) === enabled) { return; }
        if (enabled) { element.classList.add(name); } else { element.classList.remove(name); }
    };
    setClass(itemsElement, "b3-menu__items--menu", itemElements.length > 0);
    if (itemElements.length === 0) {
        return;
    }
    const firstItems = new Set<HTMLElement>();
    const lastItems = new Set<HTMLElement>();
    let groupElements: HTMLElement[] = [];
    const updateGroup = () => {
        if (groupElements.length === 0) {
            return;
        }
        firstItems.add(groupElements[0]);
        lastItems.add(groupElements[groupElements.length - 1]);
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
    itemElements.forEach(element => {
        setClass(element, "b3-menu__item--group-first", firstItems.has(element));
        setClass(element, "b3-menu__item--group-last", lastItems.has(element));
    });
};
