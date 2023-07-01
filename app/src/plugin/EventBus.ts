import {MenuItem, subMenu} from "../menus/Menu";

export class EventBus<DetailType = any> {
    private eventTarget: EventTarget;

    constructor(name = "") {
        this.eventTarget = document.appendChild(document.createComment(name));
    }

    on(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.addEventListener(type, listener);
    }

    once(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.addEventListener(type, listener, {once: true});
    }

    off(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        this.eventTarget.removeEventListener(type, listener);
    }

    emit(type: TEventBus, detail?: DetailType) {
        return this.eventTarget.dispatchEvent(new CustomEvent(type, {detail}));
    }
}

export const emitOpenMenu = (options: {
    plugins: import("./index").Plugin[],
    type: TEventBus,
    detail: any,
    separatorPosition?: "top" | "bottom",
}) => {
    const pluginSubMenu = new subMenu();
    options.detail.menu = pluginSubMenu;
    options.plugins.forEach((plugin) => {
        plugin.eventBus.emit(options.type, options.detail);
    });
    if (pluginSubMenu.menus.length > 0) {
        if (options.separatorPosition === "top") {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.plugin,
            icon: "iconPlugin",
            type: "submenu",
            submenu: pluginSubMenu.menus,
        }).element);
        if (options.separatorPosition === "bottom") {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
    }
};
