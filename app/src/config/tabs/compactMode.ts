import {Constants} from "../../constants";
import {isInMobileApp, setStorageVal} from "../../protyle/util/compatibility";
import {getFrontend} from "../../util/functions";
import {fetchSyncPost} from "../../util/fetch";

let revision = 0;

export const isCompactModeAvailable = () =>
    !isInMobileApp() && ["desktop", "desktop-window", "browser-desktop"].includes(getFrontend());

export const isCompactModeEnabled = () =>
    isCompactModeAvailable() && window.siyuan.storage?.[Constants.LOCAL_COMPACT_MODE] === true;

export const applyCompactMode = () => {
    const root = document.documentElement;
    const enabled = isCompactModeEnabled();
    const changed = root.hasAttribute(Constants.CUSTOM_SY_UI_DENSITY) !== enabled;
    if (enabled) {
        root.setAttribute(Constants.CUSTOM_SY_UI_DENSITY, "compact");
    } else {
        root.removeAttribute(Constants.CUSTOM_SY_UI_DENSITY);
    }
    document.querySelectorAll<HTMLInputElement>('input[id="compactMode"]').forEach(input => {
        input.checked = enabled;
    });
    // 使用现有布局刷新流程，重新计算页签占位和锚定菜单的位置。
    if (changed && window.siyuan.isReady) {
        window.dispatchEvent(new Event("resize"));
    }
};

export const onCompactModeStorageChanged = (key: string) => {
    if (key !== Constants.LOCAL_COMPACT_MODE) return;
    revision++;
    applyCompactMode();
};

export const setCompactModeEnabled = (enabled: boolean) => {
    if (!isCompactModeAvailable() || window.siyuan.config.readonly || window.siyuan.isPublish) return;
    window.siyuan.storage[Constants.LOCAL_COMPACT_MODE] = enabled;
    onCompactModeStorageChanged(Constants.LOCAL_COMPACT_MODE);
    return setStorageVal(Constants.LOCAL_COMPACT_MODE, enabled);
};

// 断线期间可能错过偏好推送；刷新期间的新设置优先于较早请求的结果。
export const refreshCompactMode = async (isActive = () => true) => {
    if (!isCompactModeAvailable() || !isActive()) return;
    const currentRevision = ++revision;
    const response = await fetchSyncPost("/api/storage/getLocalStorage");
    if (!isActive() || currentRevision !== revision || response.code !== 0) return;
    window.siyuan.storage[Constants.LOCAL_COMPACT_MODE] = response.data[Constants.LOCAL_COMPACT_MODE] === true;
    applyCompactMode();
};
