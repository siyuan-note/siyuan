import {MenuItem} from "./Menu";
import {buildEntryVisibilityMenuItems, buildEntryVisibilityToggleItem} from "../config/entryVisibility/menu";
import {STATUS_BAR_ROOT_PATH} from "../config/entryVisibility/catalog";

export const initStatusBarMenu = (target?: Element) => {
    const menu = window.siyuan.menus.menu;
    menu.remove();
    menu.element.setAttribute("data-name", "statusBarEntry");
    const key = target?.getAttribute("data-statusbar-entry");
    const toggle = key ? buildEntryVisibilityToggleItem(`${STATUS_BAR_ROOT_PATH}.${key}`) : undefined;
    if (toggle) {
        menu.append(new MenuItem(toggle).element);
        menu.append(new MenuItem({type: "separator"}).element);
    }
    buildEntryVisibilityMenuItems(STATUS_BAR_ROOT_PATH).forEach((item) => {
        menu.append(new MenuItem(item).element);
    });
    return menu;
};
