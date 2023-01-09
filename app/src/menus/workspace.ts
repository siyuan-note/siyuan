import {MenuItem} from "./Menu";
/// #if !BROWSER
import {dialog} from "@electron/remote";
import {ipcRenderer} from "electron";
/// #endif
import {openHistory} from "../history/history";
import {getOpenNotebookCount} from "../util/pathName";
import {mountHelp, newDailyNote} from "../util/mount";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {setStorageVal} from "../protyle/util/compatibility";
import {openCard} from "../card/openCard";

export const workspaceMenu = (rect: DOMRect) => {
    window.siyuan.menus.menu.remove();
    fetchPost("/api/system/getWorkspaces", {}, (response) => {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.dataHistory,
            icon: "iconHistory",
            accelerator: window.siyuan.config.keymap.general.dataHistory.custom,
            click: () => {
                openHistory();
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            if (getOpenNotebookCount() < 2) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.dailyNote,
                    icon: "iconCalendar",
                    accelerator: window.siyuan.config.keymap.general.dailyNote.custom,
                    click: () => {
                        newDailyNote();
                    }
                }).element);
            } else {
                const submenu: IMenu[] = [];
                window.siyuan.notebooks.forEach(item => {
                    if (!item.closed) {
                        submenu.push({
                            label: item.name,
                            click: () => {
                                fetchPost("/api/filetree/createDailyNote", {
                                    notebook: item.id,
                                    app: Constants.SIYUAN_APPID,
                                });
                                window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] = item.id;
                                setStorageVal(Constants.LOCAL_DAILYNOTEID, window.siyuan.storage[Constants.LOCAL_DAILYNOTEID]);
                            }
                        });
                    }
                });
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.dailyNote,
                    icon: "iconCalendar",
                    accelerator: window.siyuan.config.keymap.general.dailyNote.custom,
                    type: "submenu",
                    submenu
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.riffCard,
                icon: "iconRiffCard",
                accelerator: window.siyuan.config.keymap.general.riffCard.custom,
                click: () => {
                    openCard();
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.help,
            icon: "iconHelp",
            click: () => {
                mountHelp();
            }
        }).element);
        /// #if !BROWSER
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.openBy + "...",
            click: async () => {
                const localPath = await dialog.showOpenDialog({
                    defaultPath: window.siyuan.config.system.homeDir,
                    properties: ["openDirectory", "createDirectory"],
                });
                if (localPath.filePaths.length === 0) {
                    return;
                }
                openWorkspace(localPath.filePaths[0]);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.opendWorkspace,
            type: "readonly"
        }).element);
        response.data.forEach((item: IWorkspace) => {
            if (item.closed) {
                return;
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: item.path,
                click: () => {
                    openWorkspace(item.path);
                }
            }).element);
        });
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.about7,
            type: "readonly"
        }).element);
        response.data.forEach((item: IWorkspace) => {
            window.siyuan.menus.menu.append(new MenuItem({
                label: item.path,
                click: () => {
                    openWorkspace(item.path);
                }
            }).element);
        });
        /// #endif
        window.siyuan.menus.menu.popup({x: rect.left, y: rect.bottom});
    });
};

const openWorkspace = (workspace: string) => {
    /// #if !BROWSER
    fetchPost("/api/system/setWorkspaceDir", {
        path: workspace
    }, () => {
        ipcRenderer.send(Constants.SIYUAN_OPEN_WORKSPACE, {
            workspace,
            lang: window.siyuan.config.appearance.lang
        });
    });
    /// #endif
};
