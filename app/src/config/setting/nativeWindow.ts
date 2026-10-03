/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {genUUID} from "../../util/genID";
import {setStorageVal} from "../../protyle/util/compatibility";
import {exportLayout, reloadUI, resetLayout} from "../../layout/util";
import {exitSiYuan} from "../../dialog/processSystem";
import {subscribeGlobalPluginState, applyPluginReload} from "../../plugin/globalState";
import {loadPlugin, unloadPlugin} from "../../plugin/loader";
import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/globalShortcut";
import {Constants} from "../../constants";
import {hasPluginSetting} from "../../plugin";
import {getWorkspaceName} from "../../util/processTitle";
import {getDockEntryOrderSnapshot} from "../entryVisibility/dockOrder";
import {hasNativeSettingTasks} from "./taskBlocker";
import {openBazaarPath} from "../bazaar/openPath";
import type {App} from "../../index";
import type {ISettingsWindowHost} from "./windowContext";
import type {TSettingTab} from "./tabs";

export interface ISettingsCommand {
    tab?: TSettingTab;
    readme?: {type: TBazaarType; from: "bazaar" | "downloaded"; resource: IBazaarItem};
}

const geometryKey = "settingsWindowGeometry";
const hosts = new Map<string, {key: string; dispose: (notifyPlugin?: boolean, restoreShortcuts?: boolean) => void}>();
const shortcutSuspensions = new Set<string>();
let listening = false;
let openSequence = 0;
let ownerActive = true;

const safelyDispose = (callback: () => void) => {
    try {
        callback();
    } catch (error) {
        console.error("Could not dispose settings window resources", error);
    }
};

export const closeNativeSettings = (key: string) => {
    /// #if !BROWSER
    for (const [token, entry] of [...hosts]) {
        if (entry.key !== key) continue;
        try {
            ipcRenderer.send("siyuan-settings-close", {key, token});
        } finally {
            entry.dispose();
        }
    }
    /// #endif
};

export const openNativeSettings = async (app: App, command: ISettingsCommand = {},
                                         plugin?: ISettingsWindowHost["plugin"], key = "builtin") => {
    /// #if !BROWSER
    if (!ownerActive) return;
    openSequence++;
    if (!listening) {
        listening = true;
        window.addEventListener("unload", () => {
            ownerActive = false;
            for (const entry of [...hosts.values()]) entry.dispose(true, false);
        });
        ipcRenderer.on("siyuan-settings-geometry", (_event, geometry) => {
            if (!ownerActive || hasNativeSettingTasks()) return;
            window.siyuan.storage[geometryKey] = geometry;
            setStorageVal(geometryKey, geometry);
        });
        ipcRenderer.on("siyuan-settings-closed", (_event, token: string, ownerInvalidated: boolean) => {
            if (ownerInvalidated) ownerActive = false;
            hosts.get(token)?.dispose(true, !ownerInvalidated);
        });
    }
    const token = genUUID();
    const title = plugin?.name || `${window.siyuan.languages.config} - ${getWorkspaceName()}`;
    const subscriptions = new Set<() => void>();
    let listener: EventListener;
    const isActive = () => ownerActive && hosts.has(token);
    const assertActive = () => {
        if (!isActive()) throw new Error("The settings window owner is no longer available");
    };
    const dispose = (notifyPlugin = true, restoreShortcuts = true) => {
        // 先撤销宿主令牌，再调用插件，避免重入或异常留下已关闭窗口的资源。
        if (!hosts.delete(token)) return;
        const shortcutsSuspended = shortcutSuspensions.delete(token);
        if (listener) window.removeEventListener("siyuan-settings-host-" + token, listener);
        for (const unsubscribe of [...subscriptions]) safelyDispose(unsubscribe);
        if (notifyPlugin && plugin) safelyDispose(() => plugin.closed());
        if (shortcutsSuspended && restoreShortcuts && ownerActive && !shortcutSuspensions.size && !hasNativeSettingTasks()) {
            safelyDispose(() => sendGlobalShortcut(app));
        }
    };
    const close = () => {
        if (!hosts.has(token)) return;
        try {
            ipcRenderer.send("siyuan-settings-close", {key, token});
        } finally {
            dispose();
        }
    };
    hosts.set(token, {key, dispose});
    const host: ISettingsWindowHost = {
        app, title, isActive, dispose: close,
        exportLayout: options => { assertActive(); return exportLayout(options); },
        reload: () => { assertActive(); return reloadUI(); },
        resetLayout: () => { assertActive(); return resetLayout(); },
        getDockOrderSnapshot: () => { assertActive(); return getDockEntryOrderSnapshot(); },
        openBazaarPath: (type, name, storage) => { assertActive(); openBazaarPath(type, name, storage); },
        exit: setCurrentWorkspace => { assertActive(); return exitSiYuan(setCurrentWorkspace); },
        plugin: plugin && {
            name: plugin.name,
            isOpen: () => isActive() && plugin.isOpen(),
            mount: create => { assertActive(); plugin.mount(create); },
            closed: close,
        },
        suspendShortcuts: () => {
            assertActive();
            shortcutSuspensions.add(token);
            sendUnregisterGlobalShortcut(app);
        },
        restoreShortcuts: () => {
            assertActive();
            shortcutSuspensions.delete(token);
            if (!shortcutSuspensions.size && !hasNativeSettingTasks()) sendGlobalShortcut(app);
        },
        subscribePlugins: callback => {
            assertActive();
            let unsubscribe: () => void;
            let disposed = false;
            const remove = () => {
                if (disposed) return;
                disposed = true;
                subscriptions.delete(remove);
                unsubscribe?.();
            };
            subscriptions.add(remove);
            try {
                unsubscribe = subscribeGlobalPluginState(app, state => {
                    if (isActive() && !disposed) safelyDispose(() => callback(state));
                });
                if (disposed) unsubscribe();
            } catch (error) {
                remove();
                throw error;
            }
            return remove;
        },
        applyPluginReload: async data => { assertActive(); await applyPluginReload(app, data); },
        loadPlugin: async data => { assertActive(); await loadPlugin(app, data); },
        unloadPlugin: async name => { assertActive(); await unloadPlugin(app, name); },
        hasPluginSetting: name => {
            assertActive();
            const item = app.plugins.find(item => item.name === name);
            return Boolean(item && hasPluginSetting(item));
        },
        openPluginSetting: async name => {
            assertActive();
            const item = app.plugins.find(item => item.name === name);
            if (!item || !hasPluginSetting(item)) return;
            const sequence = openSequence;
            await item.openSetting();
            // 插件沿用原窗口对话框时显示其所属窗口，原生设置窗口自行接管焦点。
            if (isActive() && sequence === openSequence) ipcRenderer.send(Constants.SIYUAN_CMD, "show");
        },
    };
    try {
        const prepared = await ipcRenderer.invoke("siyuan-settings-prepare", {
            token, key, command, title,
            geometry: key === "builtin" ? window.siyuan.storage[geometryKey] : undefined,
        });
        if (!prepared.create) {
            dispose(false, false);
            return;
        }
        if (!isActive() || (plugin && !plugin.isOpen())) {
            try {
                ipcRenderer.send("siyuan-settings-close", {key, token});
            } finally {
                dispose();
            }
            return;
        }
        listener = ((event: CustomEvent<(host: ISettingsWindowHost) => void>) => {
            if (isActive() && typeof event.detail === "function") event.detail(host);
        }) as EventListener;
        window.addEventListener("siyuan-settings-host-" + token, listener);
        if (!window.open(prepared.url, prepared.frameName)) throw new Error("Could not open the settings window");
    } catch (error) {
        close();
        throw error;
    }
    /// #endif
};
