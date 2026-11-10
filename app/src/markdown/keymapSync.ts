import {Constants} from "../constants";
import {getSidebarDockOrder, getSidebarKeymap} from "../util/dockKeymap";
import {isMac} from "../protyle/util/compatibility";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

let lastKeymap: string;

export const syncMarkdownKeymap = (force = false) => {
    /// #if !BROWSER
    if (!window.siyuan?.config?.keymap || !window.siyuan.config.uiLayout?.left?.data) return;
    const keymap = getSidebarKeymap(window.siyuan.config.keymap, window.siyuan.config.system.os,
        getSidebarDockOrder(window.siyuan.config.uiLayout), isMac());
    const signature = JSON.stringify(keymap);
    if (!force && signature === lastKeymap) return;
    ipcRenderer.send(Constants.SIYUAN_SYNC_MARKDOWN_KEYMAP, keymap);
    lastKeymap = signature;
    /// #endif
};
