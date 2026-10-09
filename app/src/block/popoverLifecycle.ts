import {isAbove} from "../util/zIndex";

let generation = 0;
let cancelPending: (requireMove: boolean) => void;
const openMenus = new Set<HTMLElement>();

export const getPopoverGeneration = () => generation;

export const setPopoverCancellationHandler = (handler: (requireMove: boolean) => void) => {
    cancelPending = handler;
};

export const cancelPendingPopover = (requireMove = true) => {
    generation++;
    cancelPending?.(requireMove);
};

export const setPopoverMenuOpen = (element: HTMLElement, open: boolean) => {
    if (open) {
        openMenus.add(element);
        cancelPendingPopover();
    } else if (openMenus.delete(element)) {
        cancelPendingPopover();
    }
};

export const isPopoverMenuBlocked = (target: HTMLElement) => {
    let activeMenu: HTMLElement;
    openMenus.forEach(element => {
        if (!element.isConnected) {
            openMenus.delete(element);
        } else if (!element.classList.contains("fn__none") &&
            (!activeMenu || Number(element.style.zIndex) >= Number(activeMenu.style.zIndex))) {
            activeMenu = element;
        }
    });
    if (!activeMenu || activeMenu.contains(target)) {
        return false;
    }
    // 菜单上方打开的数据库面板仍可预览其中的引用。
    const avPanel = target.closest<HTMLElement>(".av__panel");
    return !avPanel || !isAbove(avPanel, activeMenu);
};
