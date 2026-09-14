export const getZIndex = (element: HTMLElement): number => {
    const value = Number(element.style.zIndex);
    return Number.isFinite(value) ? value : 0;
};

export const isAbove = (element: HTMLElement, reference: HTMLElement): boolean => {
    return getZIndex(element) > getZIndex(reference);
};

export const isScrollAboveMenu = (target: Element, menu: HTMLElement): boolean => {
    for (let element = target; element; element = element.parentElement) {
        if (element === menu || isAbove(element as HTMLElement, menu)) {
            return true;
        }
        // 提示层和移动端键盘栏使用样式表层级，保留其滚动能力。
        if (element.classList.contains("tooltip") || element.classList.contains("keyboard__bar")) {
            return true;
        }
    }
    return false;
};
