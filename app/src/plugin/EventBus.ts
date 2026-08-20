import {MenuItem, subMenu} from "../menus/Menu";
export {EventBus} from "./EventBusCore";
export type {IEventBusSafeEmitResult} from "./EventBusCore";

export const emitOpenMenu = (options: {
    plugins: import("./index").Plugin[],
    type: TEventBus,
    detail: any,
    separatorPosition?: "top" | "bottom",
    appendToMenu?: boolean,
}) => {
    const pluginSubMenu = new subMenu();
    options.detail.menu = pluginSubMenu;
    options.plugins.forEach((plugin) => {
        plugin.eventBus.emit(options.type, options.detail);
    });
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
