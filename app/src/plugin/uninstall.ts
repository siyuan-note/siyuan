import {App} from "../index";
import {Plugin} from "./index";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {resizeTopBar} from "../layout/util";
import {setTabPosition} from "../layout/tabUtil";
/// #endif
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {getAllEditor} from "../layout/getAll";
import {unregisterAction} from "../layout/dock/agent/frontendActions";

export const uninstall = (app: App, name: string, isReload: boolean) => {
    app.plugins.find((plugin: Plugin, index) => {
        if (plugin.name === name) {
            try {
                plugin.onunload();
            } catch (e) {
                console.error(`plugin ${plugin.name} onunload error:`, e);
            }
            try {
                plugin.kernel.destroy();
            } catch (e) {
                console.error(`plugin ${plugin.name} kernel destroy error:`, e);
            }
            if (!isReload) {
                try {
                    plugin.uninstall();
                } catch (e) {
                    console.error(`plugin ${plugin.name} uninstall error:`, e);
                }
                window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS][plugin.name] = {};
                setStorageVal(Constants.LOCAL_PLUGIN_DOCKS, window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS]);
            }
            // rm tab
            /// #if !MOBILE
            const modelsKeys = Object.keys(plugin.models);
            getAllModels().custom.forEach(custom => {
                if (modelsKeys.includes(custom.type)) {
                    if (isReload) {
                        if (custom.update) {
                            custom.update();
                        }
                    } else {
                        custom.parent.parent.removeTab(custom.parent.id);
                    }
                }
            });
            /// #endif
            // rm topBar
            for (let i = 0; i < plugin.topBarIcons.length; i++) {
                const item = plugin.topBarIcons[i];
                item.remove();
                plugin.topBarIcons.splice(i, 1);
                i--;
            }
            // rm agent actions
            plugin.agentActions.forEach(name => unregisterAction(name));
            /// #if !MOBILE
            // rm statusBar
            plugin.statusBarIcons.forEach(item => {
                item.remove();
            });
            // rm dock
            const docksKeys = Object.keys(plugin.docks);
            docksKeys.forEach(key => {
                if (window.siyuan.layout.leftDock && Object.keys(window.siyuan.layout.leftDock.data).includes(key)) {
                    window.siyuan.layout.leftDock.remove(key);
                } else if (window.siyuan.layout.rightDock && Object.keys(window.siyuan.layout.rightDock.data).includes(key)) {
                    window.siyuan.layout.rightDock.remove(key);
                } else if (window.siyuan.layout.bottomDock && Object.keys(window.siyuan.layout.bottomDock.data).includes(key)) {
                    window.siyuan.layout.bottomDock.remove(key);
                }
            });
            resizeTopBar();
            setTabPosition(true);
            /// #endif
            // rm listen
            Array.from(document.childNodes).find(item => {
                if (item.nodeType === 8 && item.textContent === name) {
                    item.remove();
                    return true;
                }
            });
            // rm plugin
            app.plugins.splice(index, 1);
            /// #if MOBILE
            // 移动端卸载插件后，若无任何插件 dock 则隐藏插件入口图标
            if (app.plugins.every(p => Object.keys(p.docks).length === 0)) {
                document.querySelector('#sidebar [data-type="sidebar-plugin-tab"]')?.classList.add("fn__none");
            }
            /// #endif
            // rm icons
            document.querySelector(`svg[data-name="${plugin.name}"]`)?.remove();
            // rm protyle toolbar
            getAllEditor().forEach(editor => {
                editor.protyle.toolbar.update(editor.protyle);
            });
            // rm style
            document.getElementById("pluginsStyle" + name)?.remove();
            /// #if !BROWSER
            plugin.commands.forEach(command => {
                if (command.globalCallback && command.customHotkey) {
                    ipcRenderer.send(Constants.SIYUAN_CMD, {
                        cmd: "unregisterGlobalShortcut",
                        accelerator: command.customHotkey
                    });
                }
            });
            /// #endif
            return true;
        }
    });
};
