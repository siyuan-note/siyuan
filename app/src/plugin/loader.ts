import {fetchSyncPost} from "../util/fetch";
import type {App} from "../index";
import {markPluginDisposed, Plugin, type TPluginDataChangeReason} from "./index";
/// #if !MOBILE
import {resizeTopBar, saveLayout} from "../layout/util";
import {getDockByType} from "../layout/tabUtil";
/// #else
import {
    dispatchMobilePluginDocksChange,
    removeMobilePluginDock,
} from "../mobile/dock/pluginDockState";
/// #endif
import {API} from "./API";
import {getFrontend, isMobile, isWindow} from "../util/functions";
import {Constants} from "../constants";
import {beginPluginTeardown, destroyPlugin} from "./uninstall";
import {setStorageVal} from "../protyle/util/compatibility";
import {getAllEditor} from "../layout/getAll";
import {getPluginDockEntryKey, refreshDockCatalog} from "../config/entryVisibility/catalog";
import {
    applyDockEntryVisibility,
    applyTopBarEntryVisibility,
    isEntryVisible,
} from "../config/entryVisibility/runtime";
import {PluginLifecycleCoordinator} from "./lifecycle";
import {
    activateCustomBlockPlugin,
    deactivateCustomBlockPlugin,
} from "./customBlockRender";
import {getHostCapabilities} from "../util/hostCapabilities";

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

const lifecycleManagers = new WeakMap<App, PluginLifecycleCoordinator<IPluginData, Plugin>>();

const createPlugin = (app: App, item: IPluginData) => {
    const exportsObj: { [key: string]: any } = {};
    const moduleObj = {exports: exportsObj};
    try {
        runCode(item.js, "plugin:" + encodeURIComponent(item.name))(requireFunc, moduleObj, exportsObj);
    } catch (error) {
        document.getElementById("pluginsStyle" + item.name)?.remove();
        console.error(`plugin ${item.name} run error:`, error);
        return;
    }
    const pluginClass = (moduleObj.exports || exportsObj).default || moduleObj.exports;
    if (typeof pluginClass !== "function") {
        document.getElementById("pluginsStyle" + item.name)?.remove();
        console.error(`plugin ${item.name} has no export`);
        return;
    }
    if (!(pluginClass.prototype instanceof Plugin)) {
        document.getElementById("pluginsStyle" + item.name)?.remove();
        console.error(`plugin ${item.name} does not extends Plugin`);
        return;
    }
    try {
        const plugin = new pluginClass({
            app,
            displayName: item.displayName,
            name: item.name,
            i18n: item.i18n
        }) as Plugin;
        insertPluginCSS(item, getPluginsStyle());
        return plugin;
    } catch (error) {
        document.getElementById("pluginsStyle" + item.name)?.remove();
        throw error;
    }
};

const getLifecycleManager = (app: App) => {
    let manager = lifecycleManagers.get(app);
    if (manager) {
        return manager;
    }
    manager = new PluginLifecycleCoordinator<IPluginData, Plugin>({
        create: (item) => createPlugin(app, item),
        attach: (plugin) => {
            if (app.plugins.some((item) => item.name === plugin.name)) {
                throw new Error(`plugin ${plugin.name} has already been loaded`);
            }
            app.plugins.push(plugin);
        },
        onload: (plugin) => plugin.onload(),
        init: (plugin) => plugin.kernel.init(),
        onLayoutReady: (plugin) => plugin.onLayoutReady(),
        mount: (plugin) => {
            mountPlugin(plugin);
            activateCustomBlockPlugin(plugin.name);
        },
        shouldReloadOnDataChange: (plugin) => plugin.onDataChanged === Plugin.prototype.onDataChanged,
        onDataChanged: (plugin, reason) => plugin.onDataChanged(reason),
        onunload: (plugin) => {
            deactivateCustomBlockPlugin(plugin.name);
            beginPluginTeardown(plugin);
            return plugin.onunload();
        },
        uninstall: (plugin) => plugin.uninstall(),
        markDisposed: (plugin) => markPluginDisposed(plugin),
        dispose: (plugin, isUninstall) => {
            deactivateCustomBlockPlugin(plugin.name);
            destroyPlugin(app, plugin, isUninstall);
        },
        onError: (name, hook, error) => console.error(`plugin ${name} ${hook} error:`, error),
    });
    lifecycleManagers.set(app, manager);
    return manager;
};

const createPluginDataLoader = () => {
    let promise: Promise<IPluginData[]>;
    return (name: string) => {
        promise ??= fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()}).then(response => response.data);
        return promise.then(items => items.find(item => item.name === name));
    };
};

export const loadPlugins = async (app: App, names?: string[], init = true) => {
    if (!getHostCapabilities().plugins) {
        return;
    }
    const manager = getLifecycleManager(app);
    let tasks: Promise<void>[];
    let shouldStart = true;
    if (names) {
        const loadPluginData = createPluginDataLoader();
        tasks = Array.from(new Set(names)).map(name => manager.requestLoad(name, () => loadPluginData(name)));
    } else {
        const batch = manager.beginLoadBatch(!manager.isStarted());
        const response = await fetchSyncPost("/api/petal/loadPetals", {frontend: getFrontend()});
        tasks = (response.data as IPluginData[]).map(item => manager.requestBatchLoad(item.name, item, batch));
        shouldStart = manager.isLatestLoadBatch(batch);
    }
    if (shouldStart) {
        manager.start();
    }
    if (!init) {
        await Promise.all(tasks);
    }
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
    document.getElementById("pluginsStyle" + item.name)?.remove();
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
    if (!getHostCapabilities().plugins) {
        return;
    }
    const manager = getLifecycleManager(app);
    manager.start();
    await manager.requestLoad(item.name, async () => item);
    saveLayout();
    getAllEditor().forEach(editor => {
        editor.protyle.toolbar.update(editor.protyle);
    });
    return manager.getInstance(item.name);
};

const updateDock = (dockItem: Config.IUILayoutDockTab[], index: number, plugin: Plugin, type: string) => {
    const dockKeys = Object.keys(plugin.docks);
    if (dockKeys.length === 0) {
        return;
    }
    dockItem.forEach((tabItem: Config.IUILayoutDockTab, tabIndex: number) => {
        if (dockKeys.includes(tabItem.type) &&
            !document.querySelector(`.dock .dock__item[data-type="${tabItem.type}"]`)) {
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

const mountPlugin = (plugin: Plugin) => {
    if (!isWindow() || isMobile()) {
        plugin.topBarIcons.forEach(element => {
            if (document.contains(element)) {
                return;
            }
            if (isMobile()) {
                if (!window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(element.id)) {
                    document.getElementById("menuPluginTopBar")?.after(element);
                }
            } else if (!isWindow()) {
                document.querySelector("#" + (element.getAttribute("data-location") === "right" ? "barPlugins" : "drag")).before(element);
            }
        });
    }
    /// #if !MOBILE
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
    applyTopBarEntryVisibility();
    resizeTopBar();
    /// #endif
    addPluginDock(plugin);
};

export const afterLayoutReady = (app: App) => {
    const manager = getLifecycleManager(app);
    void manager.setLayoutReady();
};

const getPluginCatalogPlugins = (plugin: Plugin) => window.siyuan.ws?.app?.plugins || [plugin];

export const removePluginDock = (plugin: Plugin, id: string) => {
    const key = Object.keys(plugin.docks).find((dockType) => plugin.docks[dockType].id === id);
    if (!key) {
        return;
    }
    /// #if MOBILE
    removeMobilePluginDock(key);
    /// #else
    getDockByType(key)?.remove(key);
    saveLayout();
    /// #endif
    delete plugin.docks[key];
    const plugins = getPluginCatalogPlugins(plugin);
    refreshDockCatalog(plugins);
    applyDockEntryVisibility();
    /// #if MOBILE
    dispatchMobilePluginDocksChange();
    /// #endif
};

export const addPluginDock = (plugin: Plugin) => {
    const plugins = getPluginCatalogPlugins(plugin);
    refreshDockCatalog(plugins);
    /// #if MOBILE
    dispatchMobilePluginDocksChange();
    /// #else
    if (isWindow() || !window.siyuan.layout.leftDock) {
        return;
    }
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
        if (document.querySelector(`.dock .dock__item[data-type="${key}"]`)) {
            return;
        }
        if (!window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name]) {
            window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] = {};
        }
        if (window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] &&
            window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name][key]) {
            plugin.docks[key].config = window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name][key];
        }
        const dock = plugin.docks[key];
        const entryId = getPluginDockEntryKey(plugin.name, dock.id);
        const show = dock.config.show && isEntryVisible(`dock.${entryId}`);
        const dockTab: Config.IUILayoutDockTab & {entryId: string} = {
            type: key,
            size: dock.config.size,
            show,
            icon: dock.config.icon,
            title: dock.config.title,
            entryId,
        };
        if (dock.config.position.startsWith("Left")) {
            window.siyuan.layout.leftDock.genButton([dockTab], dock.config.position === "LeftBottom" ? 1 : 0,
                dock.config.index);
        } else if (dock.config.position.startsWith("Bottom")) {
            window.siyuan.layout.bottomDock.genButton([dockTab], dock.config.position === "BottomRight" ? 1 : 0,
                dock.config.index);
        } else if (dock.config.position.startsWith("Right")) {
            window.siyuan.layout.rightDock.genButton([dockTab], dock.config.position === "RightBottom" ? 1 : 0,
                dock.config.index);
        }
    });
    applyDockEntryVisibility();
    /// #endif
};

export interface IPluginReloadData {
    uninstallPlugins?: string[],  // 插件卸载
    unloadPlugins?: string[],     // 插件禁用
    reloadPlugins?: string[],     // 插件启用，或插件代码变更
    dataChangePlugins?: string[], // 插件存储数据变更
    dataChangeReason?: TPluginDataChangeReason, // 插件存储数据变更来源
    globalPetalEnabled?: boolean,
    globalPetalDisabled?: boolean,
    globalPetalRevision?: number,
    globalPetalChanged?: boolean,
}

export const reloadPlugin = async (app: App, data: IPluginReloadData = {}) => {
    if (!getHostCapabilities().plugins) {
        return;
    }
    const manager = getLifecycleManager(app);
    const uninstallNames = new Set(data.uninstallPlugins || []);
    const unloadNames = new Set((data.unloadPlugins || []).filter(name => !uninstallNames.has(name)));
    const reloadNames = new Set((data.reloadPlugins || []).filter(name =>
        !uninstallNames.has(name) && !unloadNames.has(name)));
    const dataChangeNames = new Set((data.dataChangePlugins || []).filter(name =>
        !uninstallNames.has(name) && !unloadNames.has(name) && !reloadNames.has(name)));
    const loadPluginData = createPluginDataLoader();
    const tasks: Promise<void>[] = [];
    uninstallNames.forEach(name => tasks.push(manager.requestUninstall(name)));
    unloadNames.forEach(name => tasks.push(manager.requestUnload(name)));
    reloadNames.forEach(name => tasks.push(manager.requestReload(name, () => loadPluginData(name))));
    dataChangeNames.forEach(name => tasks.push(manager.requestDataChange(name, () => loadPluginData(name),
        data.dataChangeReason)));
    await Promise.all(tasks);
    if (reloadNames.size > 0 || dataChangeNames.size > 0) {
        getAllEditor().forEach(editor => {
            editor.protyle.toolbar.update(editor.protyle);
        });
    }
    /// #if !MOBILE
    saveLayout();
    /// #endif
};

export const unloadPlugin = async (app: App, name: string) => {
    const manager = getLifecycleManager(app);
    manager.start();
    await manager.requestUnload(name);
};

export const uninstallPlugin = async (app: App, name: string) => {
    const manager = getLifecycleManager(app);
    manager.start();
    await manager.requestUninstall(name);
};
