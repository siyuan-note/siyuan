import type {App} from "../index";
import type {Plugin} from "./index";
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
import {unregisterCapability} from "../layout/dock/agent/frontendCapabilities";
import {cancelAssetUploadsByPlugin} from "../protyle/upload/pluginEvent";
import {removeBreadcrumbButtons} from "./breadcrumbButton";
import {refreshDockCatalog} from "../config/entryVisibility/catalog";
import {isWindow} from "../util/functions";
import {destroyEventBus} from "./EventBusCore";
import {unregisterPluginCommands} from "./commandAdapter";
import {sendGlobalShortcut} from "../boot/globalEvent/globalShortcut";
import {releaseTrackedRangesByPlugin} from "../protyle/util/trackedRange";

const runCleanup = (plugin: Plugin, step: string, callback: () => unknown) => {
    try {
        const result = callback();
        if (result && typeof (result as Promise<void>).then === "function") {
            void Promise.resolve(result).catch(error => {
                console.error(`plugin ${plugin.name} ${step} cleanup error:`, error);
            });
        }
    } catch (error) {
        console.error(`plugin ${plugin.name} ${step} cleanup error:`, error);
    }
};

export const beginPluginTeardown = (plugin: Plugin) => {
    runCleanup(plugin, "commands", () => unregisterPluginCommands(plugin));
    runCleanup(plugin, "asset upload", () => cancelAssetUploadsByPlugin(plugin));
    runCleanup(plugin, "tracked ranges", () => releaseTrackedRangesByPlugin(plugin));
};

export const destroyPlugin = (app: App, plugin: Plugin, isUninstall: boolean) => {
    beginPluginTeardown(plugin);
    runCleanup(plugin, "kernel", () => plugin.kernel.destroy());
    runCleanup(plugin, "event bus", () => destroyEventBus(plugin.eventBus));
    if (isUninstall) {
        runCleanup(plugin, "dock storage", () => {
            const pluginDocks = window.siyuan.storage?.[Constants.LOCAL_PLUGIN_DOCKS] || {};
            pluginDocks[plugin.name] = {};
            if (window.siyuan.storage) {
                window.siyuan.storage[Constants.LOCAL_PLUGIN_DOCKS] = pluginDocks;
            }
            setStorageVal(Constants.LOCAL_PLUGIN_DOCKS, pluginDocks);
        });
    }
    // 移除插件页签。
    /// #if !MOBILE
    runCleanup(plugin, "custom tabs", () => {
        const modelsKeys = Object.keys(plugin.models);
        getAllModels().custom.forEach(custom => {
            if (modelsKeys.includes(custom.type)) {
                runCleanup(plugin, "custom tab", () => {
                    if (isUninstall) {
                        custom.parent.parent.removeTab(custom.parent.id);
                    } else if (custom.update) {
                        return custom.update();
                    }
                });
            }
        });
    });
    /// #endif
    // 移除顶栏按钮。
    runCleanup(plugin, "top bar", () => {
        plugin.topBarIcons.forEach(item => runCleanup(plugin, "top bar", () => item.remove()));
        plugin.topBarIcons.length = 0;
    });
    runCleanup(plugin, "breadcrumb", () => removeBreadcrumbButtons(plugin.name));
    // 移除插件注册的 Agent 能力。
    runCleanup(plugin, "agent capability", () => {
        plugin.agentCapabilities.forEach((capability) => runCleanup(plugin, "agent capability", () =>
            unregisterCapability(capability.id, capability.generation)));
    });
    /// #if !MOBILE
    // 移除状态栏元素。
    runCleanup(plugin, "status bar", () => {
        plugin.statusBarIcons.forEach(item => runCleanup(plugin, "status bar", () => item.remove()));
    });
    // 移除插件停靠栏。
    runCleanup(plugin, "dock", () => {
        Object.keys(plugin.docks).forEach(key => {
            runCleanup(plugin, "dock", () => {
                if (window.siyuan.layout.leftDock && Object.keys(window.siyuan.layout.leftDock.data).includes(key)) {
                    window.siyuan.layout.leftDock.remove(key);
                } else if (window.siyuan.layout.rightDock && Object.keys(window.siyuan.layout.rightDock.data).includes(key)) {
                    window.siyuan.layout.rightDock.remove(key);
                } else if (window.siyuan.layout.bottomDock && Object.keys(window.siyuan.layout.bottomDock.data).includes(key)) {
                    window.siyuan.layout.bottomDock.remove(key);
                }
            });
        });
    });
    runCleanup(plugin, "top bar layout", () => resizeTopBar());
    runCleanup(plugin, "tab layout", () => setTabPosition(true));
    /// #endif
    const index = app.plugins.indexOf(plugin);
    if (index > -1) {
        app.plugins.splice(index, 1);
    }
    runCleanup(plugin, "dock catalog", () => refreshDockCatalog(app.plugins));
    /// #if MOBILE
    // 移动端卸载插件后，若无任何插件停靠栏则隐藏插件入口图标。
    runCleanup(plugin, "mobile plugin entry", () => {
        if (app.plugins.every(item => Object.keys(item.docks).length === 0)) {
            const pluginTabElement = document.querySelector("[data-type='sidebar-plugin-tab']");
            pluginTabElement?.classList.add("fn__none");
            if (pluginTabElement?.classList.contains("toolbar__icon--active")) {
                const fallbackTabElement = pluginTabElement.parentElement?.querySelector<HTMLElement>(
                    "[data-type$='-tab']:not(.fn__none)"
                );
                if (fallbackTabElement) {
                    fallbackTabElement.dispatchEvent(new MouseEvent("click", {bubbles: true}));
                } else {
                    pluginTabElement.classList.remove("toolbar__icon--active");
                    document.querySelector("[data-type='sidebar-plugin']")?.classList.add("fn__none");
                    const sidePanel = pluginTabElement.closest<HTMLElement>(".side-panel");
                    if (sidePanel) {
                        sidePanel.style.transform = "";
                    }
                }
            }
        }
    });
    /// #endif
    runCleanup(plugin, "icons", () => document.querySelector(`svg[data-name="${plugin.name}"]`)?.remove());
    runCleanup(plugin, "editor toolbar", () => {
        getAllEditor().forEach(editor => {
            runCleanup(plugin, "editor toolbar", () => editor.protyle.toolbar.update(editor.protyle));
        });
    });
    runCleanup(plugin, "style", () => document.getElementById("pluginsStyle" + plugin.name)?.remove());
    runCleanup(plugin, "commands", () => unregisterPluginCommands(plugin));
    /// #if !BROWSER
    if (!isWindow()) {
        runCleanup(plugin, "global shortcut", () => {
            plugin.commands.forEach(command => {
                if (command.globalCallback && command.customHotkey) {
                    runCleanup(plugin, "global shortcut", () => {
                        ipcRenderer.send(Constants.SIYUAN_CMD, {
                            cmd: "unregisterGlobalShortcut",
                            accelerator: command.customHotkey
                        });
                    });
                }
            });
        });
        if (window.siyuan.languages?.["_trayMenu"]) {
            runCleanup(plugin, "global shortcut sync", () => sendGlobalShortcut(app));
        }
    }
    /// #endif
};
