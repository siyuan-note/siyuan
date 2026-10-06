import type {App} from "../../index";
import type {Dialog} from "../../dialog";
import type {IPluginReloadData} from "../../plugin/loader";
import type {IGlobalPluginStateSnapshot} from "../../plugin/globalStateCoordinator";
import type {TDockOrderSnapshot} from "../entryVisibility/dockOrder";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export interface ISettingsWindowHost {
    app: App;
    title: string;
    isActive: () => boolean;
    dispose: () => void;
    reload: () => Promise<void>;
    resetLayout: () => Promise<void>;
    getDockOrderSnapshot: () => TDockOrderSnapshot;
    openBazaarPath: (type: TBazaarType, name: string, storage?: boolean) => void;
    exportLayout: (options: {cb: () => void; errorExit: boolean}) => Promise<void>;
    exit: (setCurrentWorkspace?: boolean) => Promise<void>;
    subscribePlugins: (listener: (state: IGlobalPluginStateSnapshot) => void) => () => void;
    applyPluginReload: (data: IPluginReloadData) => Promise<void>;
    loadPlugin: (data: IPluginData) => Promise<void>;
    unloadPlugin: (name: string) => Promise<void>;
    openPluginSetting: (name: string) => Promise<void>;
    hasPluginSetting: (name: string) => boolean;
    suspendShortcuts: () => void;
    restoreShortcuts: () => void;
    plugin?: {
        name: string;
        isOpen: () => boolean;
        mount: (create: (options: {width: string; height: string; items: IPluginSettingOption[];
            confirmCallback: () => void; destroyCallback: () => void}) => Dialog) => void;
        closed: () => void;
    };
}

let host: ISettingsWindowHost;
export const setSettingsWindowHost = (value: ISettingsWindowHost) => { host = value; };
export const getSettingsWindowHost = () => host;
export const getSettingsOwnerApp = () => host?.app || window.siyuan.ws?.app;
export const isSettingsWindow = () => Boolean(host) ||
    (typeof document !== "undefined" && document.body.classList.contains("body--settings"));

// 重载和重置结束设置会话，不触发关闭时的旧窗口偏好保存。
export const closeSettingsWindow = () => {
    /// #if !BROWSER
    if (isSettingsWindow()) {
        ipcRenderer.send("siyuan-settings-close-self");
        return true;
    }
    /// #endif
    return false;
};
