import {layoutToJSON} from "../layout/util";
/// #if !BROWSER
import { ipcRenderer } from "electron";
/// #endif
import {Constants} from "../constants";
import {Tab} from "../layout/Tab";

export const openNewWindow = (tab: Tab) => {
    const json = {};
    layoutToJSON(tab, json);
    /// #if !BROWSER
    ipcRenderer.send(Constants.SIYUAN_OPENWINDOW, `${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`);
    /// #endif
    tab.parent.removeTab(tab.id);
};
