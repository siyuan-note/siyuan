import {MenuItem} from "./Menu";
import {mountHelp} from "../util/mount";
import {openSetting} from "../config";
/// #if !BROWSER
import {getCurrentWindow} from "@electron/remote";
/// #endif
import {exportLayout, getDockByType} from "../layout/util";
import {fetchPost} from "../util/fetch";
import {getAllDocks} from "../layout/getAll";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {openHistory} from "../util/history";

export const initToolbarMore = () => {
    window.siyuan.menus.menu.remove();
    getAllDocks().forEach(item => {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: item.icon,
            accelerator: window.siyuan.config.keymap.general[item.hotkeyLangId].custom,
            label: window.siyuan.languages[item.hotkeyLangId],
            click: () => {
                getDockByType(item.type).toggleModel(item.type);
                if (item.type === "file" && getSelection().rangeCount > 0) {
                    const range = getSelection().getRangeAt(0);
                    const wysiwygElement = hasClosestByClassName(range.startContainer, "protyle-wysiwyg", true);
                    if (wysiwygElement) {
                        wysiwygElement.blur();
                    }
                }
            }
        }).element);
    });
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconSettings",
            accelerator: window.siyuan.config.keymap.general.config.custom,
            label: window.siyuan.languages.config,
            click: () => {
                openSetting();
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.dataHistory,
            icon: "iconVideo",
            accelerator: window.siyuan.config.keymap.general.history.custom,
            click: () => {
                openHistory();
            }
        }).element);
    }
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconLock",
        accelerator: window.siyuan.config.keymap.general.lockScreen.custom,
        label: window.siyuan.languages.lockScreen,
        click: () => {
            exportLayout(false, () => {
                fetchPost("/api/system/logoutAuth", {}, () => {
                    window.location.href = "/";
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconHeart",
        label: window.siyuan.languages.feedback,
        click: () => {
            if ("zh_CN" === window.siyuan.config.lang) {
                window.open("https://ld246.com/article/1649901726096");
            } else {
                window.open("https://github.com/siyuan-note/siyuan/issues");
            }
        }
    }).element);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconHelp",
            label: window.siyuan.languages.help,
            click: () => {
                mountHelp();
            }
        }).element);
    }
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
