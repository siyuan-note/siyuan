import {MobileCustom} from "./MobileCustom";

export const MOBILE_PLUGIN_DOCKS_CHANGE_EVENT = "siyuan-mobile-plugin-docks-change";

const customs = new Map<string, MobileCustom>();

export const getMobilePluginDockSide = (position: TPluginDockPosition) => {
    return position === "LeftTop" || position === "LeftBottom" || position === "BottomLeft" ? "left" : "right";
};

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
