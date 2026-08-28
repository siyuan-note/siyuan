export const resetMenuHorizontalScroll = (menuElement: HTMLElement) => {
    menuElement.scrollLeft = 0;
    menuElement.querySelectorAll<HTMLElement>(".b3-menu__items, .b3-menu__submenu").forEach((element) => {
        element.scrollLeft = 0;
    });
};
