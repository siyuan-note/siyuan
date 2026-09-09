import {Constants} from "../../constants";
import {setStorageVal} from "../util/compatibility";

export const getLastExportPath = () => {
    const value = window.siyuan.storage[Constants.LOCAL_EXPORTPATH];
    return typeof value?.path === "string" ? value.path : "";
};

export const setLastExportPath = (exportPath: string) => {
    if (!exportPath) {
        return;
    }
    window.siyuan.storage[Constants.LOCAL_EXPORTPATH] = {path: exportPath};
    setStorageVal(Constants.LOCAL_EXPORTPATH, window.siyuan.storage[Constants.LOCAL_EXPORTPATH]);
};
