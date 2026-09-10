import {Constants} from "../constants";
import {MenuItem} from "./Menu";
import {buildEntryVisibilityMenuItems, buildEntryVisibilityToggleItem} from "../config/entryVisibility/menu";
import {TOP_BAR_ROOT_PATH} from "../config/entryVisibility/catalog";
import {refreshTopBarEntryCatalog} from "../config/entryVisibility/runtime";

export const initTopBarMenu = (target?: Element) => {
    const menu = window.siyuan.menus.menu;
    menu.remove();
    menu.element.setAttribute("data-name", Constants.MENU_BAR_ENTRY);
    refreshTopBarEntryCatalog();
    if (target) {
        const key = target.getAttribute("data-topbar-entry");
        const item = key ? buildEntryVisibilityToggleItem(`${TOP_BAR_ROOT_PATH}.${key}`) : undefined;
        if (item) {
            menu.append(new MenuItem(item).element);
        }
    } else {
        buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH).forEach((item) => {
            menu.append(new MenuItem(item).element);
        });
    }
    return menu;
};
