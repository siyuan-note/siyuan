import {Constants} from "../../constants";
import {isInMobileApp, setStorageVal} from "../../protyle/util/compatibility";
import {getFrontend} from "../../util/functions";
import {fetchSyncPost} from "../../util/fetch";

let revision = 0;

export const isMenuMouseScrollAvailable = () =>
    !isInMobileApp() && ["desktop", "desktop-window", "browser-desktop"].includes(getFrontend());

export const isMenuMouseScrollEnabled = () =>
    isMenuMouseScrollAvailable() && window.siyuan.storage?.[Constants.LOCAL_MENU_MOUSE_SCROLL] === true;

const syncControls = () => {
    document.querySelectorAll<HTMLInputElement>('input[id="menuMouseScroll"]').forEach(input => {
        input.checked = isMenuMouseScrollEnabled();
    });
};

export const onMenuMouseScrollStorageChanged = (key: string) => {
    if (key !== Constants.LOCAL_MENU_MOUSE_SCROLL) return;
    revision++;
    syncControls();
};

export const setMenuMouseScrollEnabled = (enabled: boolean) => {
    if (!isMenuMouseScrollAvailable() || window.siyuan.config.readonly || window.siyuan.isPublish) return;
    window.siyuan.storage[Constants.LOCAL_MENU_MOUSE_SCROLL] = enabled;
    onMenuMouseScrollStorageChanged(Constants.LOCAL_MENU_MOUSE_SCROLL);
    return setStorageVal(Constants.LOCAL_MENU_MOUSE_SCROLL, enabled);
};

// 重连时补齐离线期间的偏好变更，保留较新操作和推送的结果。
export const refreshMenuMouseScroll = async (isActive = () => true) => {
    if (!isMenuMouseScrollAvailable() || !isActive()) return;
    const currentRevision = ++revision;
    const response = await fetchSyncPost("/api/storage/getLocalStorage");
    if (!isActive() || currentRevision !== revision || response.code !== 0) return;
    window.siyuan.storage[Constants.LOCAL_MENU_MOUSE_SCROLL] = response.data[Constants.LOCAL_MENU_MOUSE_SCROLL] === true;
    syncControls();
};
