import {isInMobileApp} from "../../protyle/util/compatibility";
import {getFrontend} from "../../util/functions";
import {appearanceConfigApi} from "./appearanceRuntime";

export const isMenuMouseScrollAvailable = () =>
    !isInMobileApp() && ["desktop", "desktop-window", "browser-desktop"].includes(getFrontend());

export const isMenuMouseScrollEnabled = () =>
    isMenuMouseScrollAvailable() && window.siyuan.config.appearance?.menuMouseScroll === true;

export const syncMenuMouseScroll = () => {
    document.querySelectorAll<HTMLInputElement>('input[id="menuMouseScroll"]').forEach(input => {
        input.checked = isMenuMouseScrollEnabled();
    });
};

export const setMenuMouseScrollEnabled = (enabled: boolean) => {
    if (!isMenuMouseScrollAvailable() || window.siyuan.config.readonly || window.siyuan.isPublish) return;
    return appearanceConfigApi.patch("menuMouseScroll", enabled);
};
