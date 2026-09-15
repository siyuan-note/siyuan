import type {subMenu} from "../menus/Menu";

const callbacks = new WeakMap<Element, (menu: subMenu) => void>();

export const setTopBarContextMenu = (element: Element, callback?: (menu: subMenu) => void) => {
    if (callback) {
        callbacks.set(element, callback);
    } else {
        callbacks.delete(element);
    }
};

export const fillTopBarContextMenu = (element: Element, menu: subMenu) => {
    callbacks.get(element)?.(menu);
};
