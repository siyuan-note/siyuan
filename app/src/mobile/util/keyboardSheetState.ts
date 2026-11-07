const sheets = new Set<HTMLElement>();
const stateClass = "keyboard--sheet-open";

const isVisible = (element: HTMLElement) => {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" &&
        style.visibility !== "collapse" && style.display !== "none";
};

const isToolbarShown = (toolbar: HTMLElement) => {
    if (!toolbar.isConnected) return false;
    // 状态类供主题派生样式使用，不能让主题通过该类隐藏工具栏后反向触发显隐循环。
    for (let element = toolbar; element; element = element.parentElement) {
        if (element.hidden || element.classList.contains("fn__none") || element.style.display === "none" ||
            element.style.visibility === "hidden" || element.style.visibility === "collapse") return false;
    }
    return true;
};

const update = () => {
    const toolbar = document.getElementById("keyboardToolbar");
    if (!toolbar) return;
    const active = isToolbarShown(toolbar) && Array.from(sheets).some(isVisible);
    // 避免自身 class 变更反复触发属性观察器。
    if (toolbar.classList.contains(stateClass) !== active) toolbar.classList.toggle(stateClass, active);
};

export const bindKeyboardSheetState = (sheet: HTMLElement) => {
    sheets.add(sheet);
    const observer = new MutationObserver(update);
    const elements = new Set<HTMLElement>();
    // 祖先的隐藏样式和移除同样会影响抽屉与工具栏的实际可见性。
    [sheet, document.getElementById("keyboardToolbar")].forEach(element => {
        while (element) {
            elements.add(element);
            element = element.parentElement;
        }
    });
    elements.forEach(element => observer.observe(element, {
        attributes: true, attributeFilter: ["class", "style", "hidden"], childList: true,
    }));
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    resizeObserver?.observe(sheet);
    const toolbar = document.getElementById("keyboardToolbar");
    if (toolbar) resizeObserver?.observe(toolbar);
    window.addEventListener("resize", update);
    update();
    return () => {
        observer.disconnect();
        resizeObserver?.disconnect();
        window.removeEventListener("resize", update);
        sheets.delete(sheet);
        update();
    };
};
