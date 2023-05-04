import {fetchPost} from "../util/fetch";
import {App} from "../index";
import {Plugin} from "./index";

const getObject = (key: string) => {
    const api = {
        siyuan: {
            Plugin: Plugin
        }
    };
    // @ts-ignore
    return api[key];
}

const runCode = (code: string, sourceURL: string) => {
    return window.eval("(function anonymous(require, module){".concat(code, "\n})\n//# sourceURL=").concat(sourceURL, "\n"))
}

export const loadPlugins = (app: App) => {
    fetchPost("/api/plugin/loadPlugins", {}, response => {
        let css = "";
        response.data.forEach((item: { id: string, name: string, jsCode: string, cssCode: string, lang: IObject }) => {
            const moduleObj = {}
            const execResult = runCode(item.jsCode, "plugin:" + encodeURIComponent(item.id))
            execResult(getObject, moduleObj);
            // @ts-ignore
            const plugin: Plugin = new moduleObj.exports.default({app, id: item.id, lang: item.lang})
            app.plugins.push(plugin);
            plugin.onload();
            css += item.cssCode + "\n";
        })
        const styleElement = document.createElement("style");
        styleElement.textContent = css;
        document.head.append(styleElement);
    })
}
