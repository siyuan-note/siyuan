import {fetchSyncPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";
/// #if !MOBILE
import {resizeTopBar} from "../layout/util";
/// #endif
import {API} from "./API";
import {getFrontend, isMobile, isWindow} from "../util/functions";
import {Constants} from "../constants";

const requireFunc = (key: string) => {
    const modules = {
        siyuan: API
    };
    // @ts-ignore
    return modules[key]
        ?? window.require?.(key);
};
if (window.require instanceof Function) {
    requireFunc.__proto__ = window.require;
}

const runCode = (code: string, sourceURL: string) => {
    return window.eval("(function anonymous(require, module, exports){".concat(code, "\n})\n//# sourceURL=").concat(sourceURL, "\n"));
};

export const loadPlugins = async (app: App) => {
    const response = await fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()});
    let css = "";
    // 为加快启动速度，不进行 await
    response.data.forEach((item: IPluginData) => {
        loadPluginJS(app, item);
        css += item.css || "" + "\n";
    });
    const pluginsStyle = document.getElementById("pluginsStyle");
    if (pluginsStyle) {
        pluginsStyle.innerHTML = css;
    } else {
        document.head.insertAdjacentHTML("beforeend", `<style id="pluginsStyle">${css}</style>`);
    }
};

const loadPluginJS = async (app: App, item: IPluginData) => {
    const exportsObj: { [key: string]: any } = {};
    const moduleObj = {exports: exportsObj};
    try {
        runCode(item.js, "plugin:" + encodeURIComponent(item.name))(requireFunc, moduleObj, exportsObj);
    } catch (e) {
        console.error(`plugin ${item.name} run error:`, e);
        return;
    }
    const pluginClass = (moduleObj.exports || exportsObj).default || moduleObj.exports;
    if (typeof pluginClass !== "function") {
        console.error(`plugin ${item.name} has no export`);
        return;
    }
    if (!(pluginClass.prototype instanceof Plugin)) {
        console.error(`plugin ${item.name} does not extends Plugin`);
        return;
    }
    const plugin = new pluginClass({
        app,
        displayName: item.displayName,
        name: item.name,
        i18n: item.i18n
    });
    app.plugins.push(plugin);
    try {
        await plugin.onload();
    } catch (e) {
        console.error(`plugin ${item.name} onload error:`, e);
    }
    return plugin;
};

// 启用插件
export const loadPlugin = async (app: App, item: IPluginData) => {
    const plugin = await loadPluginJS(app, item);
    const styleElement = document.createElement("style");
    styleElement.textContent = item.css;
    document.head.append(styleElement);
    afterLoadPlugin(plugin);
    return plugin;
};


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

export const afterLoadPlugin = (plugin: Plugin) => {
    try {
        plugin.onLayoutReady();
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
