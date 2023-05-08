import {fetchPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";
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

export const loadPlugins = (app: App) => {
    fetchPost("/api/petal/loadPetals", {}, response => {
        let css = "";
        response.data.forEach((item: { name: string, js: string, css: string, i18n: IObject }) => {
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
            plugin.onload();
            css += item.css || "" + "\n";
        });
        const styleElement = document.createElement("style");
        styleElement.textContent = css;
        document.head.append(styleElement);
    });
};
