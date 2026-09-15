import {Constants} from "../constants";
import {MenuItem} from "./Menu";
import {buildEntryVisibilityMenuItems, buildEntryVisibilityToggleItem} from "../config/entryVisibility/menu";
import {TOP_BAR_ROOT_PATH} from "../config/entryVisibility/catalog";
import {refreshTopBarEntryCatalog} from "../config/entryVisibility/runtime";
import {emitOpenMenu} from "../plugin/EventBus";

export const initTopBarMenu = (target?: Element) => {
    const menu = window.siyuan.menus.menu;
    menu.remove();
    menu.element.setAttribute("data-name", Constants.MENU_BAR_ENTRY);
    refreshTopBarEntryCatalog();
    const key = target?.getAttribute("data-topbar-entry") || null;
    const pluginItems = emitOpenMenu({
        type: "open-menu-topbar",
        detail: {element: target || null, entryPath: key ? `${TOP_BAR_ROOT_PATH}.${key}` : null},
        appendToMenu: false,
    });
    let hasPluginItem = false;
    let separator: IMenu | undefined;
    pluginItems.forEach((item) => {
        if (item.ignore) {
            return;
        }
        if (item.type === "separator") {
            separator = item;
            return;
        }
        // 仅在有效项目之间保留分隔线，组尾分隔线由顶栏菜单统一添加。
        if (hasPluginItem && separator) {
            menu.append(new MenuItem(separator).element);
        }
        menu.append(new MenuItem(item).element);
        hasPluginItem = true;
        separator = undefined;
    });
    if (hasPluginItem) {
        menu.append(new MenuItem({id: "separator_pluginTop", type: "separator"}).element);
    }
    if (target) {
        const item = key ? buildEntryVisibilityToggleItem(`${TOP_BAR_ROOT_PATH}.${key}`) : undefined;
        if (item) {
            menu.append(new MenuItem(item).element);
            menu.append(new MenuItem({type: "separator"}).element);
        }
    }
    buildEntryVisibilityMenuItems(TOP_BAR_ROOT_PATH).forEach((item) => {
        menu.append(new MenuItem(item).element);
    });
    return menu;
};
