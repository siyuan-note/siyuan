/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {genUUID} from "../../util/genID";
import {setStorageVal} from "../../protyle/util/compatibility";
import {exportLayout} from "../../layout/util";
import {exitSiYuan} from "../../dialog/processSystem";
import {subscribeGlobalPluginState, applyPluginReload} from "../../plugin/globalState";
import {loadPlugin, unloadPlugin} from "../../plugin/loader";
import {sendGlobalShortcut, sendUnregisterGlobalShortcut} from "../../boot/globalEvent/globalShortcut";
import {Constants} from "../../constants";
import {hasPluginSetting} from "../../plugin";
import type {App} from "../../index";
import type {ISettingsWindowHost} from "./windowContext";
import type {TSettingTab} from "./tabs";

export interface ISettingsCommand {
    tab?: TSettingTab;
    readme?: {type: TBazaarType; from: "bazaar" | "downloaded"; resource: IBazaarItem};
}

const geometryKey = "settingsWindowGeometry";
const hosts = new Map<string, {host: ISettingsWindowHost; listener: EventListener}>();
let listening = false;
let openSequence = 0;

export const closeNativeSettings = (key: string) => {
    /// #if !BROWSER
    ipcRenderer.send("siyuan-settings-close", key);
    /// #endif
};

export const openNativeSettings = async (app: App, command: ISettingsCommand = {},
                                         plugin?: ISettingsWindowHost["plugin"], key = "builtin") => {
    /// #if !BROWSER
    openSequence++;
    if (!listening) {
        listening = true;
        window.addEventListener("unload", () => {
            hosts.forEach(entry => entry.host.plugin?.closed());
        });
        ipcRenderer.on("siyuan-settings-geometry", (_event, geometry) => {
            window.siyuan.storage[geometryKey] = geometry;
            setStorageVal(geometryKey, geometry);
        });
        ipcRenderer.on("siyuan-settings-closed", (_event, token: string) => {
            const entry = hosts.get(token);
            if (entry) {
                window.removeEventListener("siyuan-settings-host-" + token, entry.listener);
                entry.host.plugin?.closed();
                entry.host.restoreShortcuts();
                hosts.delete(token);
            }
        });
    }
    const token = genUUID();
    const prepared = await ipcRenderer.invoke("siyuan-settings-prepare", {
        token, key, command, title: plugin?.name || window.siyuan.languages.config,
        geometry: key === "builtin" ? window.siyuan.storage[geometryKey] : undefined,
    });
    if (!prepared.create) {
        return;
    }
    if (plugin && !plugin.isOpen()) {
        closeNativeSettings(key);
        return;
    }
    const host: ISettingsWindowHost = {
        app, exportLayout, exit: exitSiYuan, plugin,
        suspendShortcuts: () => sendUnregisterGlobalShortcut(app),
        restoreShortcuts: () => sendGlobalShortcut(app),
        subscribePlugins: listener => subscribeGlobalPluginState(app, listener),
        applyPluginReload: async data => { await applyPluginReload(app, data); },
        loadPlugin: async data => { await loadPlugin(app, data); },
        unloadPlugin: async name => { await unloadPlugin(app, name); },
        hasPluginSetting: name => {
            const item = app.plugins.find(item => item.name === name);
            return Boolean(item && hasPluginSetting(item));
        },
        openPluginSetting: async name => {
            const item = app.plugins.find(item => item.name === name);
            if (!item || !hasPluginSetting(item)) return;
            const sequence = openSequence;
            await item.openSetting();
            // 插件沿用原窗口对话框时显示其所属窗口，原生设置窗口自行接管焦点。
            if (sequence === openSequence) ipcRenderer.send(Constants.SIYUAN_CMD, "show");
        },
    };
    const listener = ((event: CustomEvent<(host: ISettingsWindowHost) => void>) => event.detail(host)) as EventListener;
    hosts.set(token, {host, listener});
    window.addEventListener("siyuan-settings-host-" + token, listener);
    const child = window.open(prepared.url, prepared.frameName);
    if (!child) {
        window.removeEventListener("siyuan-settings-host-" + token, listener);
        hosts.delete(token);
        throw new Error("Could not open the settings window");
    }
    /// #endif
};
