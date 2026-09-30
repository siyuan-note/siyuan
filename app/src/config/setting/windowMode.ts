import {Constants} from "../../constants";
import {setStorageVal} from "../../protyle/util/compatibility";

export const getSettingsWindowMode = () => window.siyuan.storage[Constants.LOCAL_SETTINGS_WINDOW_MODE] === 0 ? 0 : 1;

export const setSettingsWindowMode = (value: unknown) => {
    if (value !== 0 && value !== 1) return;
    window.siyuan.storage[Constants.LOCAL_SETTINGS_WINDOW_MODE] = value;
    setStorageVal(Constants.LOCAL_SETTINGS_WINDOW_MODE, value);
};
