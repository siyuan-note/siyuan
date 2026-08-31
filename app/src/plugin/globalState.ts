import type {App} from "../index";
import {fetchSyncPost} from "../util/fetch";
import {
    GlobalPluginStateCoordinator,
    type IGlobalPluginStatePayload,
    type IGlobalPluginStateSnapshot,
} from "./globalStateCoordinator";
import {type IPluginReloadData, reloadPlugin} from "./loader";

type TGlobalPluginReloadData = IPluginReloadData & IGlobalPluginStatePayload;

const coordinators = new WeakMap<App, GlobalPluginStateCoordinator<TGlobalPluginReloadData>>();

const getCoordinator = (app: App) => {
    let coordinator = coordinators.get(app);
    if (coordinator) {
        return coordinator;
    }
    coordinator = new GlobalPluginStateCoordinator<TGlobalPluginReloadData>({
        initialPetalDisabled: window.siyuan.config.bazaar.petalDisabled,
        applyLifecycle: (payload) => reloadPlugin(app, payload),
        applyConfig: (petalDisabled) => {
            window.siyuan.config.bazaar.petalDisabled = petalDisabled;
        },
    });
    coordinators.set(app, coordinator);
    return coordinator;
};

const isGlobalPluginState = (data: IPluginReloadData): data is TGlobalPluginReloadData =>
    typeof data.globalPetalEnabled === "boolean" &&
    typeof data.globalPetalDisabled === "boolean" &&
    typeof data.globalPetalRevision === "number" &&
    typeof data.globalPetalChanged === "boolean";

export const applyPluginReload = (app: App, data: IPluginReloadData = {}) => {
    if (!isGlobalPluginState(data)) {
        return reloadPlugin(app, data);
    }
    return getCoordinator(app).apply(data);
};

export const syncGlobalPluginConfig = (app: App, petalDisabled: boolean) => {
    getCoordinator(app).syncConfig(petalDisabled);
};

export const subscribeGlobalPluginState = (app: App, listener: (state: IGlobalPluginStateSnapshot) => void) =>
    getCoordinator(app).subscribe(listener);

export const setGlobalPluginsDisabled = async (app: App, petalDisabled: boolean) => {
    const response = await fetchSyncPost("/api/setting/setBazaarPetalDisabled", {petalDisabled});
    if (response.code !== 0 || !response.data) {
        throw new Error(response.msg || "Failed to update the global plugin state");
    }
    await applyPluginReload(app, response.data as TGlobalPluginReloadData);
};
