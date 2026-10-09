import {hasClosestByAttribute} from "../protyle/util/hasClosest";

export const globalClickHideMenu = (element: HTMLElement) => {
    if (!window.siyuan.menus.menu.element.contains(element) && !hasClosestByAttribute(element, "data-menu", "true")) {
        if (getSelection().rangeCount > 0 && window.siyuan.menus.menu.element.contains(getSelection().getRangeAt(0).startContainer) &&
            window.siyuan.menus.menu.element.contains(document.activeElement)) {
            // https://ld246.com/article/1654567749834/comment/1654589171218#comments
        } else {
            window.siyuan.menus.menu.remove();
        }
    }
};
