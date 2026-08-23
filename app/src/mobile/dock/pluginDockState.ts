import {MobileCustom} from "./MobileCustom";

let custom: MobileCustom | undefined;

export const getMobilePluginDock = () => custom;

export const openMobilePluginDock = (type: string, create: () => MobileCustom) => {
    if (custom?.type === type) {
        return;
    }
    const previousType = custom?.type;
    custom?.destroy?.();
    if (previousType) {
        delete window.siyuan.mobile.docks[previousType];
    }
    custom = create();
    window.siyuan.mobile.docks[type] = custom;
};

export const removeMobilePluginDock = (type: string) => {
    const dock = window.siyuan.mobile.docks[type] as MobileCustom;
    if (custom?.type === type) {
        custom.destroy?.();
        custom.element.innerHTML = "";
        custom = undefined;
    } else {
        dock?.destroy?.();
    }
    delete window.siyuan.mobile.docks[type];
};
