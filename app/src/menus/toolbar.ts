import {MenuItem} from "./Menu";
import {openSetting} from "../config";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {openHistory} from "../util/history";

export const initToolbarMore = () => {
    window.siyuan.menus.menu.remove();
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconSettings",
            accelerator: window.siyuan.config.keymap.general.config.custom,
            label: window.siyuan.languages.config,
            click: () => {
                openSetting();
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.dataHistory,
        icon: "iconVideo",
        accelerator: window.siyuan.config.keymap.general.history.custom,
        click: () => {
            openHistory();
        }
    }).element);
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconBug",
        label: window.siyuan.languages.debug,
        click: () => {
            getCurrentWindow().webContents.openDevTools({mode: "bottom"});
        }
    }).element);
    /// #endif
    return window.siyuan.menus.menu;
};
