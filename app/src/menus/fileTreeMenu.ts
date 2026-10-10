export const toggleFileTreeMenu = (button: Element, openMenu: () => void) => {
    const menu = window.siyuan.menus.menu;
    if (!menu.element.classList.contains("fn__none") && menu.data === button) {
        menu.remove();
        return;
    }
    openMenu();
    // 记录具体入口，使同一按钮关闭菜单，其他按钮切换操作对象。
    menu.data = button;
};
