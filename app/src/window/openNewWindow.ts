import {layoutToJSON} from "../layout/util";
/// #if !BROWSER
import {BrowserWindow} from "@electron/remote";
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {Tab} from "../layout/Tab";

export const openNewWindow = (tab: Tab) => {
    const win = new BrowserWindow({
        show: true,
        trafficLightPosition: {x: 8, y: 13},
        width: 1032,
        height: 650,
        transparent: window.siyuan.config.system.os !== "linux",
        frame: "darwin" === window.siyuan.config.system.os,
        icon: path.join(window.siyuan.config.system.appDir, "stage", "icon-large.png"),
        titleBarStyle: "hidden",
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true,
            webviewTag: true,
            webSecurity: false,
        },
    });
    const json = {};
    layoutToJSON(tab, json);
    win.loadURL(`${window.location.protocol}//${window.location.host}/stage/build/app/window.html?v=${Constants.SIYUAN_VERSION}&json=${JSON.stringify(json)}`);
    tab.parent.removeTab(tab.id);
};
