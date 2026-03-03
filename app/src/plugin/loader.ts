import {fetchSyncPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";
/// #if !MOBILE
import {resizeTopBar, saveLayout} from "../layout/util";
/// #endif
import {API} from "./API";
import {getFrontend, isMobile, isWindow} from "../util/functions";
import {Constants} from "../constants";
import {uninstall} from "./uninstall";
import {setStorageVal} from "../protyle/util/compatibility";
import {getAllEditor} from "../layout/getAll";

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

export const loadPlugins = async (app: App, names?: string[], init = true) => {
    const response = await fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()});
    const pluginsStyle = getPluginsStyle();
    for (let i = 0; i < response.data.length; i++) {
        const item = response.data[i] as IPluginData;
        if (!names || (names && names.includes(item.name))) {
            if (init) {
                // 初始化时为加快启动速度，已特殊处理，不进行 await
                loadPluginJS(app, item);
            } else {
                await loadPluginJS(app, item);
            }
            insertPluginCSS(item, pluginsStyle);
        }
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
    }) as Plugin;
    app.plugins.push(plugin);
    try {
        await plugin.onload();
    } catch (e) {
        console.error(`plugin ${item.name} onload error:`, e);
    }
    return plugin;
};

const getPluginsStyle = () => {
    let pluginsStyle = document.getElementById("pluginsStyle");
    if (!pluginsStyle) {
        pluginsStyle = document.createElement("style");
        pluginsStyle.id = "pluginsStyle"; // 用于将内联样式插入到插件样式前的标识
        document.head.append(pluginsStyle);
    }
    return pluginsStyle;
};

const insertPluginCSS = (item: IPluginData, pluginsStyle: HTMLElement) => {
    if (!item.css) {
        return;
    }
    const styleElement = document.createElement("style");
    styleElement.id = "pluginsStyle" + item.name;
    styleElement.textContent = item.css;
    pluginsStyle.insertAdjacentElement("afterend", styleElement);
};

// 启用插件
export const loadPlugin = async (app: App, item: IPluginData) => {
    const plugin = await loadPluginJS(app, item);
    insertPluginCSS(item, getPluginsStyle());
    afterLoadPlugin(plugin);
    saveLayout();
    getAllEditor().forEach(editor => {
        editor.protyle.toolbar.update(editor.protyle);
    });
    return plugin;
};

const updateDock = (dockItem: Config.IUILayoutDockTab[], index: number, plugin: Plugin, type: string) => {
    const dockKeys = Object.keys(plugin.docks);
    dockItem.forEach((tabItem: Config.IUILayoutDockTab, tabIndex: number) => {
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
            if (!window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name]) {
                window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] = {};
            }
            window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name][tabItem.type] = plugin.docks[tabItem.type].config;
            setStorageVal(Constants.LOCAL_PLUGIN_DOCKS, window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS]);
        }
    });
};

export const afterLoadPlugin = (plugin: Plugin) => {
    try {
        plugin.onLayoutReady();
    } catch (e) {
        console.error(`plugin ${plugin.name} onLayoutReady error:`, e);
    }

    if (!isWindow() || isMobile()) {
        plugin.topBarIcons.forEach(element => {
            if (document.contains(element)) {
                return;
            }
            if (isMobile()) {
                if (!window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(element.id)) {
                    document.querySelector("#menuAbout").after(element);
                }
            } else if (!isWindow()) {
                if (window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(element.id)) {
                    element.classList.add("fn__none");
                }
                document.querySelector("#" + (element.getAttribute("data-location") === "right" ? "barPlugins" : "drag")).before(element);
            }
        });
    }
    /// #if !MOBILE
    resizeTopBar();
    plugin.statusBarIcons.forEach(element => {
        if (document.contains(element)) {
            return;
        }
        const statusElement = document.getElementById("status");
        if (element.getAttribute("data-location") === "right") {
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
    window.siyuan.config.uiLayout.left.data.forEach((dockItem: Config.IUILayoutDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Left");
    });
    window.siyuan.config.uiLayout.right.data.forEach((dockItem: Config.IUILayoutDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Right");
    });
    window.siyuan.config.uiLayout.bottom.data.forEach((dockItem: Config.IUILayoutDockTab[], index: number) => {
        updateDock(dockItem, index, plugin, "Bottom");
    });
    Object.keys(plugin.docks).forEach(key => {
        if (window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] && window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name][key]) {
            plugin.docks[key].config = window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name][key];
        }
        const dock = plugin.docks[key];
        const hotkey = window.siyuan.config.keymap.plugin[plugin.name] ? window.siyuan.config.keymap.plugin[plugin.name][key]?.custom : undefined;
        if (dock.config.position.startsWith("Left")) {
            window.siyuan.layout.leftDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey
            }], dock.config.position === "LeftBottom" ? 1 : 0, dock.config.index);
        } else if (dock.config.position.startsWith("Bottom")) {
            window.siyuan.layout.bottomDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey
            }], dock.config.position === "BottomRight" ? 1 : 0, dock.config.index);
        } else if (dock.config.position.startsWith("Right")) {
            window.siyuan.layout.rightDock.genButton([{
                type: key,
                size: dock.config.size,
                show: dock.config.show,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey
            }], dock.config.position === "RightBottom" ? 1 : 0, dock.config.index);
        }
    });
    /// #endif
};

export const reloadPlugin = async (app: App, data: {
    upsertCodePlugins?: string[],
    upsertDataPlugins?: string[],
    unloadPlugins?: string[],
    uninstallPlugins?: string[],
} = {}) => {
    const {upsertCodePlugins = [], upsertDataPlugins = [], unloadPlugins = [], uninstallPlugins = []} = data;
    // 禁用
    unloadPlugins.forEach((item) => {
        uninstall(app, item, true);
    });
    // 卸载
    uninstallPlugins.forEach((item) => {
        uninstall(app, item, false);
    });
    upsertCodePlugins.forEach((item) => {
        uninstall(app, item, true);
    });
    loadPlugins(app, upsertCodePlugins, false).then(() => {
        app.plugins.forEach(item => {
            if (upsertCodePlugins.includes(item.name)) {
                afterLoadPlugin(item);
                getAllEditor().forEach(editor => {
                    editor.protyle.toolbar.update(editor.protyle);
                });
            }
        });
    });
    app.plugins.forEach(item => {
        if (upsertDataPlugins.includes(item.name)) {
            try {
                item.onDataChanged();
            } catch (e) {
                console.error(`plugin ${item.name} onDataChanged error:`, e);
            }
        }
    });
    /// #if !MOBILE
    saveLayout();
    /// #endif
};
