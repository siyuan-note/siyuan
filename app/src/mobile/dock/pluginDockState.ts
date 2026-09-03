import {MobileCustom} from "./MobileCustom";
import type {App} from "../../index";
import type {IMobileSidePanelPluginDock} from "../util/mobileSidePanelConfig";
import {getPluginDockEntryKey, type PluginDockEntryKey} from "../../plugin/dockKey";

export const MOBILE_PLUGIN_DOCKS_CHANGE_EVENT = "siyuan-mobile-plugin-docks-change";

const customs = new Map<string, MobileCustom>();

export const getMobilePluginDockSide = (position: TPluginDockPosition) => {
    return position === "LeftTop" || position === "LeftBottom" || position === "BottomLeft" ? "left" : "right";
};

export interface IMobilePluginDockEntry {
    key: PluginDockEntryKey,
    dockID: string,
    pluginName: string,
    pluginDisplayName: string,
    type: string,
    config: IPluginDockTab,
    mobileModel: (element: Element) => MobileCustom,
    order: number,
}

export const getMobilePluginDockEntries = (app: App = window.siyuan.ws.app) => {
    const entries: IMobilePluginDockEntry[] = [];
    app.plugins.forEach((plugin) => {
        Object.entries(plugin.docks).forEach(([type, dock]) => {
            entries.push({
                key: getPluginDockEntryKey(plugin.name, dock.id),
                dockID: dock.id,
                pluginName: plugin.name,
                pluginDisplayName: plugin.displayName?.trim() || plugin.name,
                type,
                config: dock.config,
                mobileModel: dock.mobileModel,
                order: entries.length,
            });
        });
    });
    return entries.sort((first, second) =>
        (first.config.index ?? 1000) - (second.config.index ?? 1000) || first.order - second.order);
};

export const getMobilePluginDockLayouts = (
    entries: readonly IMobilePluginDockEntry[] = getMobilePluginDockEntries(),
): IMobileSidePanelPluginDock[] => entries.map((entry) => ({
    id: entry.type,
    side: getMobilePluginDockSide(entry.config.position),
    index: entry.config.index,
}));

export const dispatchMobilePluginDocksChange = () => {
    window.dispatchEvent(new CustomEvent(MOBILE_PLUGIN_DOCKS_CHANGE_EVENT));
};

export const getMobilePluginDock = (type: string) => customs.get(type);

export const openMobilePluginDock = (type: string, create: () => MobileCustom) => {
    if (customs.has(type)) {
        return;
    }
    const custom = create();
    customs.set(type, custom);
    window.siyuan.mobile.docks[type] = custom;
};

export const removeMobilePluginDock = (type: string) => {
    const custom = customs.get(type) || window.siyuan.mobile.docks[type] as MobileCustom;
    if (custom) {
        custom.destroy?.();
        custom.element.innerHTML = "";
    }
    customs.delete(type);
    delete window.siyuan.mobile.docks[type];
};
