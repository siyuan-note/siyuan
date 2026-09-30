import type {App} from "../../index";
import type {Dialog} from "../../dialog";
import type {IPluginReloadData} from "../../plugin/loader";
import type {IGlobalPluginStateSnapshot} from "../../plugin/globalStateCoordinator";

export interface ISettingsWindowHost {
    app: App;
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
export const isSettingsWindow = () => typeof document !== "undefined" && document.body.classList.contains("body--settings");
