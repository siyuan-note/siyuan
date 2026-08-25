import {MenuItem, subMenu} from "../menus/Menu";
import {emitToPlugins, hasPluginSubscriber} from "./EventBusCore";
export {EventBus} from "./EventBusCore";

export const emitOpenMenu = (options: {
    type: TEventBus,
    detail: any,
    separatorPosition?: "top" | "bottom",
    appendToMenu?: boolean,
}) => {
    if (!hasPluginSubscriber(options.type)) {
        return [];
    }
    const pluginSubMenu = new subMenu();
    options.detail.menu = pluginSubMenu;
    emitToPlugins(options.type, options.detail);
    if (pluginSubMenu.menus.length > 0 && options.appendToMenu !== false) {
        if (options.separatorPosition === "top") {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_pluginTop", type: "separator"}).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "plugin",
            label: window.siyuan.languages.plugin,
            icon: "iconPlugin",
            type: "submenu",
            submenu: pluginSubMenu.menus,
        }).element);
        if (options.separatorPosition === "bottom") {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_pluginBottom", type: "separator"}).element);
        }
    }
    return pluginSubMenu.menus;
};
