import {Constants} from "../constants";
import {isBrowser} from "../util/functions";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

export interface IWindowGeometry {
    version: 1;
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    fullscreen: boolean;
}

export const captureWindowGeometry = async (): Promise<IWindowGeometry | undefined> => {
    if (isBrowser()) {
        return;
    }
    /// #if !BROWSER
    try {
        return await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "getWindowGeometry"}) || undefined;
    } catch (error) {
        console.error(error);
    }
    /// #endif
};

export const restoreWindowGeometry = async (geometry?: IWindowGeometry) => {
    if (isBrowser() || !geometry) {
        return;
    }
    /// #if !BROWSER
    await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: "setWindowGeometry", geometry});
    /// #endif
};
