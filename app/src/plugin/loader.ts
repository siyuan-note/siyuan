import {fetchPost, fetchSyncPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";
/// #if !MOBILE
import {exportLayout} from "../layout/util";
/// #endif
import {API} from "./API";

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

export const loadPlugins = async (app: App) => {
    const response = await fetchSyncPost("/api/petal/loadPetals");
    let css = "";
    response.data.forEach((item: IPluginData) => {
        loadPluginJS(app, item);
        css += item.css || "" + "\n";
    });
    const styleElement = document.createElement("style");
    styleElement.textContent = css;
    document.head.append(styleElement);
};

const loadPluginJS = (app: App, item: IPluginData) => {
    const exportsObj: { [key: string]: any } = {};
    const moduleObj = {exports: exportsObj};
    try {
        runCode(item.js, "plugin:" + encodeURIComponent(item.name))(getObject, moduleObj, exportsObj);
    } catch (e) {
        console.error(`eval plugin ${item.name} error:`, e);
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
        name: item.name,
        i18n: item.i18n
    });
    app.plugins.push(plugin);
    try {
        plugin.onload();
    } catch (e) {
        console.error(`plugin ${item.name} onload error:`, e);
    }
    return plugin;
};

export const loadPlugin = (app: App, item: IPluginData) => {
    const plugin = loadPluginJS(app, item);
    Object.keys(plugin.docks).forEach(key => {
        const dock = plugin.docks[key];
        if (dock.config.position.startsWith("Left")) {
            window.siyuan.layout.leftDock.genButton([{
                type: key,
                size: dock.config.size,
                show: false,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "LeftBottom" ? 1 : 0, true);
        } else if (dock.config.position.startsWith("Bottom")) {
            window.siyuan.layout.bottomDock.genButton([{
                type: key,
                size: dock.config.size,
                show: false,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "BottomRight" ? 1 : 0, true);
        } else if (dock.config.position.startsWith("Right")) {
            window.siyuan.layout.rightDock.genButton([{
                type: key,
                size: dock.config.size,
                show: false,
                icon: dock.config.icon,
                title: dock.config.title,
                hotkey: dock.config.hotkey
            }], dock.config.position === "RightBottom" ? 1 : 0, true);
        }
    });
    const styleElement = document.createElement("style");
    styleElement.textContent = item.css;
    document.head.append(styleElement);
    /// #if !MOBILE
    exportLayout({
        reload: false,
        onlyData: false,
        errorExit: false
    });
    /// #endif
};
