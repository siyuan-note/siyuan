import {Constants} from "../../constants";
import {getFrontend} from "../../util/functions";
import {appearanceConfigApi} from "./appearanceRuntime";

export const isCompactModeAvailable = () =>
    ["desktop", "desktop-window", "browser-desktop"].includes(getFrontend());

export const isCompactModeEnabled = () =>
    isCompactModeAvailable() && window.siyuan.config.appearance?.compactMode === true;

export const applyCompactMode = () => {
    const root = document.documentElement;
    const enabled = isCompactModeEnabled();
    const changed = root.hasAttribute(Constants.ATTRIBUTE_UI_DENSITY) !== enabled;
    if (enabled) {
        root.setAttribute(Constants.ATTRIBUTE_UI_DENSITY, "compact");
    } else {
        root.removeAttribute(Constants.ATTRIBUTE_UI_DENSITY);
    }
    document.querySelectorAll<HTMLInputElement>('input[id="compactMode"]').forEach(input => {
        input.checked = enabled;
    });
    // 使用现有布局刷新流程，重新计算页签占位和锚定菜单的位置。
    if (changed && window.siyuan.isReady) {
        window.dispatchEvent(new Event("resize"));
    }
};

export const setCompactModeEnabled = (enabled: boolean) => {
    if (!isCompactModeAvailable() || window.siyuan.config.readonly || window.siyuan.isPublish) return;
    return appearanceConfigApi.patch("compactMode", enabled);
};
