import {MenuItem, subMenu} from "../menus/Menu";

type ListenerEntry<DetailType> = {
    type: TEventBus,
    listener: (event: CustomEvent<DetailType>) => void,
    /** 仅 once 注册时有值，触发后条目会从 listenerEntries 移除 */
    wrapper?: (event: CustomEvent<DetailType>) => void,
};

export class EventBus<DetailType = any> {
    private name: string;
    private eventTarget: Comment;
    private listenerEntries: ListenerEntry<DetailType>[] = [];

    constructor(name = "") {
        this.name = name;
        this.eventTarget = document.appendChild(document.createComment(name));
    }

    emit(type: TEventBus, detail?: DetailType) {
        return this.eventTarget.dispatchEvent(new CustomEvent(type, {detail, cancelable: true}));
    }

    on(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        if (this.listenerEntries.some((e) => e.type === type && e.listener === listener)) {
            console.warn("[" + this.name + "] Listener already registered", {type, listener});
            return;
        }
        this.eventTarget.addEventListener(type, listener as EventListener);
        this.listenerEntries.push({type, listener});
    }

    once(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        if (this.listenerEntries.some((e) => e.type === type && e.listener === listener)) {
            console.warn("[" + this.name + "] Listener already registered", {type, listener});
            return;
        }
        const wrapper = (event: CustomEvent<DetailType>) => {
            listener(event);
            const idx = this.listenerEntries.findIndex((e) => e.wrapper === wrapper);
            if (idx !== -1) this.listenerEntries.splice(idx, 1);
        };
        this.eventTarget.addEventListener(type, wrapper as EventListener, {once: true});
        this.listenerEntries.push({type, listener, wrapper});
    }

    off(type: TEventBus, listener: (event: CustomEvent<DetailType>) => void) {
        const idx = this.listenerEntries.findIndex((e) => e.type === type && e.listener === listener);
        if (idx !== -1) {
            const entry = this.listenerEntries[idx];
            this.eventTarget.removeEventListener(type, (entry.wrapper ?? entry.listener) as EventListener);
            this.listenerEntries.splice(idx, 1);
        }
    }

    // https://github.com/siyuan-note/siyuan/issues/16910
    destroy() {
        this.listenerEntries.forEach(({type, listener, wrapper}) => {
            this.eventTarget.removeEventListener(type, (wrapper ?? listener) as EventListener);
        });
        this.listenerEntries.length = 0; // 清空数组避免外部引用
        this.eventTarget.remove();
        const idx = customEventBuses.indexOf(this);
        if (idx !== -1) customEventBuses.splice(idx, 1);
    }
}

export const emitToEventBus = (type: TEventBus, detail?: any) => {
    // 避免在遍历过程中数组被修改导致插件被跳过
    const plugins = [...window.siyuan.ws.app.plugins];
    const buses = [...customEventBuses];
    plugins.forEach((p) => p.eventBus.emit(type, detail));
    buses.forEach((bus) => bus.emit(type, detail));
};

export const customEventBuses: EventBus[] = [];

export const registerCustomEventBus = (name?: string): EventBus => {
    const bus = new EventBus(name ?? "custom-event-bus-" + (customEventBuses.length + 1));
    customEventBuses.push(bus);
    return bus;
};

export const emitOpenMenu = (options: {
    type: TEventBus,
    detail: any,
    separatorPosition?: "top" | "bottom",
}) => {
    const pluginSubMenu = new subMenu();
    options.detail.menu = pluginSubMenu;
    emitToEventBus(options.type, options.detail);
    if (pluginSubMenu.menus.length > 0) {
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
};
