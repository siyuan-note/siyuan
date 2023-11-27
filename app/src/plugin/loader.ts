import {fetchSyncPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";
/// #if !MOBILE
import {exportLayout, resizeTopBar} from "../layout/util";
/// #endif
import {API} from "./API";
import {getFrontend, isMobile, isWindow} from "../util/functions";
import {Constants} from "../constants";
import {addStyleElement} from "../protyle/util/addStyle";

const getObject = (key: string) => {
    const api = {
        siyuan: API
    };
    // @ts-ignore
    return api[key];
};

const runCode = (code: string, sourceURL: string) => {
    return window.eval("(function anonymous(require, module, exports){".concat(code, "\n})\n//# sourceURL=").concat(sourceURL, "\n"));
};

export class PluginLoader {
    protected readonly ready: Promise<IPluginData[]>;
    protected readonly plugins: Plugin[];

    constructor(
        protected readonly app: App,
    ) {
        this.ready = this._loadPetals();
        this.plugins = this.app.plugins;
    }

    public async register(): Promise<Plugin[]> {
        await this.init();
        await this.load();
        await this.layoutReady();
        return this.plugins;
    }

    public async init(): Promise<void> {
        const petals = await this.ready;
        petals.forEach(petal => {
            this.plugins.push(initPlugin(this.app, petal));
        });
    }

    public async load(): Promise<boolean[]> {
        return Promise.all(this.plugins.map(plugin => loadPlugin(plugin)));
    }

    public async layoutReady(): Promise<IMenu[][]> {
        return Promise.all(this.plugins.map(plugin => afterLoadPlugin(plugin)));
    }

    protected async _loadPetals(): Promise<IPluginData[]> {
        const response = await fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()});
        return response.data as IPluginData[];
    }
}

// 初始化并加载一个插件
export const registerPlugin = async (app: App, petal: IPluginData) => {
    const plugin = initPlugin(app, petal);
    app.plugins.push(plugin);

    await loadPlugin(plugin);
    await afterLoadPlugin(plugin);
    /// #if !MOBILE
    exportLayout({
        reload: false,
        onlyData: false,
        errorExit: false
    });
    /// #endif
    return plugin;
};

// 添加插件样式
const addPluginStyle = (plugin: IPluginData) => {
    let styleElement = document.head.querySelector(`style[data-name="${plugin.name}"]`);
    if (styleElement) {
        if (styleElement.textContent !== plugin.css) {
            styleElement.textContent = plugin.css;
        }
    } else {
        const styleElement = document.createElement("style");
        styleElement.dataset.name = plugin.name;
        styleElement.dataset.displayName = plugin.displayName;
        styleElement.textContent = plugin.css;
        addStyleElement(styleElement, Constants.ELEMENT_ID_META_ANCHOR.PLUGIN_STYLE);
    }
    return styleElement;
}

// 初始化插件 constructor
const initPlugin = (app: App, petal: IPluginData) => {
    const exportsObj: { [key: string]: any } = {};
    const moduleObj = { exports: exportsObj };
    try {
        runCode(petal.js, "plugin:" + encodeURIComponent(petal.name))(getObject, moduleObj, exportsObj);
    } catch (e) {
        console.error(`plugin ${petal.name} run error:`, e);
        return;
    }
    const pluginClass = (moduleObj.exports || exportsObj).default || moduleObj.exports;
    if (typeof pluginClass !== "function") {
        console.error(`plugin ${petal.name} has no export`);
        return;
    }
    if (!(pluginClass.prototype instanceof Plugin)) {
        console.error(`plugin ${petal.name} does not extends Plugin`);
        return;
    }
    const style = addPluginStyle(petal);
    const plugin: Plugin = new pluginClass({
        app,
        i18n: petal.i18n,
        name: petal.name,
        displayName: petal.displayName,
        style,
    });
    return plugin;
};

// 加载插件 onload
const loadPlugin = async (plugin: Plugin) => {
    plugin.loaded = new Promise(async (resolve) => {
        try {
            await plugin.onload();
            resolve(true);
        } catch (e) {
            console.error(`plugin ${plugin.name} onload error:`, e);
            resolve(false);
        }
    });
    return plugin.loaded;
}

const updateDock = (dockItem: IDockTab[], index: number, plugin: Plugin, type: string) => {
    const dockKeys = Object.keys(plugin.docks);
    dockItem.forEach((tabItem: IDockTab, tabIndex: number) => {
        if (dockKeys.includes(tabItem.type)) {
            if (type === "Left") {
                plugin.docks[tabItem.type].config.position = index === 0 ? "LeftTop" : "LeftBottom";
            } else if (type === "Right") {
                plugin.docks[tabItem.type].config.position = index === 0 ? "RightTop" : "RightBottom";
            } else if (type === "Bottom") {
                plugin.docks[tabItem.type].config.position = index === 0 ? "BottomLeft" : "BottomRight";
            }
            plugin.docks[tabItem.type].config.index = tabIndex;
            plugin.docks[tabItem.type].config.show = tabItem.show;
            plugin.docks[tabItem.type].config.size = tabItem.size;
        }
    });
};

const mergePluginHotkey = (plugin: Plugin) => {
    if (!window.siyuan.config.keymap.plugin) {
        window.siyuan.config.keymap.plugin = {};
    }
    for (let i = 0; i < plugin.commands.length; i++) {
        const command = plugin.commands[i];
        if (!window.siyuan.config.keymap.plugin[plugin.name]) {
            command.customHotkey = command.hotkey;
            window.siyuan.config.keymap.plugin[plugin.name] = {
                [command.langKey]: {
                    default: command.hotkey,
                    custom: command.hotkey,
                }
            };
        } else if (!window.siyuan.config.keymap.plugin[plugin.name][command.langKey]) {
            command.customHotkey = command.hotkey;
            window.siyuan.config.keymap.plugin[plugin.name][command.langKey] = {
                default: command.hotkey,
                custom: command.hotkey,
            };
        } else if (window.siyuan.config.keymap.plugin[plugin.name][command.langKey]) {
            if (typeof window.siyuan.config.keymap.plugin[plugin.name][command.langKey].custom === "string") {
                command.customHotkey = window.siyuan.config.keymap.plugin[plugin.name][command.langKey].custom;
            } else {
                command.customHotkey = command.hotkey;
            }
            window.siyuan.config.keymap.plugin[plugin.name][command.langKey]["default"] = command.hotkey;
        }
        if (typeof command.customHotkey !== "string") {
            console.error(`${plugin.name} - commands data is error and has been removed.`);
            plugin.commands.splice(i, 1);
            i--;
        }
    }
};

const afterLoadPlugin = async (plugin: Plugin) => {
    try {
        await plugin.loaded;
        await plugin.onLayoutReady();
    } catch (e) {
        console.error(`plugin ${plugin.name} onLayoutReady error:`, e);
    }

    if (!isWindow() || isMobile()) {
        const unPinMenu: IMenu[] = [];
        plugin.topBarIcons.forEach(element => {
            if (isMobile()) {
                if (window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(element.id)) {
                    unPinMenu.push({
                        iconHTML: element.firstElementChild.outerHTML,
                        label: element.textContent.trim(),
                        click() {
                            element.dispatchEvent(new CustomEvent("click"));
                        }
                    });
                } else {
                    document.querySelector("#menuAbout").after(element);
                }
            } else if (!isWindow()) {
                if (window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(element.id)) {
                    element.classList.add("fn__none");
                }
                document.querySelector("#" + (element.getAttribute("data-position") === "right" ? "barPlugins" : "drag")).before(element);
            }
        });
        if (isMobile() && unPinMenu.length > 0) {
            return unPinMenu;
        }
    }
    /// #if !MOBILE
    resizeTopBar();
    mergePluginHotkey(plugin);
    plugin.statusBarIcons.forEach(element => {
        const statusElement = document.getElementById("status");
        if (element.getAttribute("data-position") === "right") {
            statusElement.insertAdjacentElement("beforeend", element);
        } else {
            statusElement.insertAdjacentElement("afterbegin", element);
        }
    });
    /// #endif
    if (isWindow()) {
        return;
    }

    /// #if !MOBILE
    window.siyuan.config.uiLayout.left.data.forEach((dockItem: IDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Left");
    });
    window.siyuan.config.uiLayout.right.data.forEach((dockItem: IDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Right");
    });
    window.siyuan.config.uiLayout.bottom.data.forEach((dockItem: IDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Bottom");
    });
    Object.keys(plugin.docks).forEach(key => {
        const dock = plugin.docks[key];
        if (dock.config.position.startsWith("Left")) {
            window.siyuan.layout.leftDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "LeftBottom" ? 1 : 0, dock.config.index);
        } else if (dock.config.position.startsWith("Bottom")) {
            window.siyuan.layout.bottomDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "BottomRight" ? 1 : 0, dock.config.index);
        } else if (dock.config.position.startsWith("Right")) {
            window.siyuan.layout.rightDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "RightBottom" ? 1 : 0, dock.config.index);
        }
    });
    /// #endif
};
