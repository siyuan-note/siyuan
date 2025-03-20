import {App} from "../index";
import {Plugin} from "../plugin";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {resizeTopBar} from "../layout/util";
/// #endif
import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {getAllEditor} from "../layout/getAll";

export const uninstall = (app: App, name: string, isUninstall = false) => {
    app.plugins.find((plugin: Plugin, index) => {
        if (plugin.name === name) {
            // rm command
            try {
                plugin.onunload();
                if (isUninstall) {
                    plugin.uninstall();
                    window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] = {};
                    setStorageVal(Constants.LOCAL_PLUGIN_DOCKS, window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS]);
                }
            } catch (e) {
                console.error(`plugin ${plugin.name} onunload error:`, e);
            }
            // rm tab
            /// #if !MOBILE
            const modelsKeys = Object.keys(plugin.models);
            getAllModels().custom.forEach(custom => {
                if (modelsKeys.includes(custom.type)) {
                    custom.parent.parent.removeTab(custom.parent.id);
                }
            });
            /// #endif
            // rm topBar
            plugin.topBarIcons.forEach(item => {
                item.remove();
            });
            /// #if !MOBILE
            resizeTopBar();
            // rm statusBar
            plugin.statusBarIcons.forEach(item => {
                item.remove();
            });
            /// #endif
            // rm dock
            const docksKeys = Object.keys(plugin.docks);
            docksKeys.forEach(key => {
                if (Object.keys(window.siyuan.layout.leftDock.data).includes(key)) {
                    window.siyuan.layout.leftDock.remove(key);
                } else if (Object.keys(window.siyuan.layout.rightDock.data).includes(key)) {
                    window.siyuan.layout.rightDock.remove(key);
                } else if (Object.keys(window.siyuan.layout.bottomDock.data).includes(key)) {
                    window.siyuan.layout.bottomDock.remove(key);
                }
            });
            // rm listen
            Array.from(document.childNodes).find(item => {
                if (item.nodeType === 8 && item.textContent === name) {
                    item.remove();
                    return true;
                }
            });
            // rm plugin
            app.plugins.splice(index, 1);
            // rm protyle toolbar
            getAllEditor().forEach(editor => {
                editor.protyle.toolbar.update(editor.protyle);
            });
            // rm style
            document.getElementById("pluginsStyle" + name)?.remove();
            return true;
        }
    });
};
