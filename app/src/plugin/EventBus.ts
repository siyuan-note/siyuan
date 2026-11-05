import {MenuItem, subMenu} from "../menus/Menu";
import {emitToPlugins, hasPluginSubscriber} from "./EventBusCore";
export {EventBus} from "./EventBusCore";

export const emitOpenMenu = (options: {
    type: TEventBus,
    detail: any,
    separatorPosition?: "top" | "bottom",
    appendToMenu?: boolean,
    isCurrent?: () => boolean,
}) => {
    if (!hasPluginSubscriber(options.type)) {
        return [];
    }
    const pluginSubMenu = new subMenu();
    const detail = typeof options.detail === "function" ? options.detail() : options.detail;
    detail.menu = pluginSubMenu;
    emitToPlugins(options.type, detail);
    if (options.isCurrent && !options.isCurrent()) {
        return pluginSubMenu.menus;
    }
    if (pluginSubMenu.menus.length > 0 && options.appendToMenu !== false) {
        const createPluginElement = () => new MenuItem({
            id: "plugin",
            label: window.siyuan.languages.plugin,
            icon: "iconPlugin",
            type: "submenu",
            submenu: pluginSubMenu.menus,
        }).element;
        let pluginElement: HTMLElement;
        if (options.isCurrent) {
            pluginElement = createPluginElement();
            if (!options.isCurrent()) {
                return pluginSubMenu.menus;
            }
        }
        if (options.separatorPosition === "top") {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_pluginTop", type: "separator"}).element);
        }
        window.siyuan.menus.menu.append(pluginElement || createPluginElement());
        if (options.separatorPosition === "bottom") {
            window.siyuan.menus.menu.append(new MenuItem({id: "separator_pluginBottom", type: "separator"}).element);
        }
    }
    return pluginSubMenu.menus;
};
