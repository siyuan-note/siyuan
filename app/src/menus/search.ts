import {MenuItem} from "./Menu";
import {copySubMenu} from "./commonMenuItem";

export const initSearchMenu = (id: string) => {
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.copy,
        type: "submenu",
        submenu: copySubMenu(id,false)
    }).element);
    return window.siyuan.menus.menu;
};
