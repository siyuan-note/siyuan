import {hasClosestByAttribute} from "../protyle/util/hasClosest";

export const bindTouchMenuDismiss = () => {
    // 原生文字选择可能不派发 click；在捕获阶段关闭外部触摸对应的弹出菜单，保留编辑器的默认输入行为。
    document.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.pointerType !== "touch" && event.pointerType !== "pen") {
            return;
        }
        const menu = window.siyuan.menus?.menu;
        if (!menu || menu.element.classList.contains("fn__none") ||
            menu.element.classList.contains("b3-menu--fullscreen")) {
            return;
        }
        globalClickHideMenu(event.target as HTMLElement);
    }, {capture: true, passive: true});
};

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
