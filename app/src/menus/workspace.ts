import {MenuItem} from "./Menu";
/// #if !BROWSER
import {dialog, getCurrentWindow} from "@electron/remote";
import {ipcRenderer, shell} from "electron";
/// #endif
import {openHistory} from "../history/history";
import {getOpenNotebookCount, originalPath} from "../util/pathName";
import {mountHelp, newDailyNote} from "../util/mount";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {setStorageVal, writeText} from "../protyle/util/compatibility";
import {openCard} from "../card/openCard";
import {openSetting} from "../config";
import {getAllDocks} from "../layout/getAll";
import {getDockByType} from "../layout/util";
import {lockScreen} from "../dialog/processSystem";
import {showMessage} from "../dialog/message";
import {unicode2Emoji} from "../emoji";
import {Dock} from "../layout/dock";
import {escapeHtml} from "../util/escape";
import {viewCards} from "../card/viewCards";

const togglePinDock = (dock: Dock, icon: string) => {
    return {
        label: `${dock.pin ? window.siyuan.languages.unpin : window.siyuan.languages.pin}`,
        icon,
        current: !dock.pin,
        click() {
            dock.togglePin();
        }
    };
};

export const workspaceMenu = (rect: DOMRect) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "barWorkspace") {
        window.siyuan.menus.menu.remove();
        return;
    }
    fetchPost("/api/system/getWorkspaces", {}, (response) => {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", "barWorkspace");
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.config,
                icon: "iconSettings",
                accelerator: window.siyuan.config.keymap.general.config.custom,
                click: () => {
                    openSetting();
                }
            }).element);
        }
        const dockMenu: IMenu[] = [];
        getAllDocks().forEach(item => {
            dockMenu.push({
                icon: item.icon,
                accelerator: window.siyuan.config.keymap.general[item.hotkeyLangId].custom,
                label: window.siyuan.languages[item.hotkeyLangId],
                click() {
                    getDockByType(item.type).toggleModel(item.type);
                }
            });
        });
        if (!window.siyuan.config.readonly) {
            dockMenu.push({type: "separator"});
            dockMenu.push(togglePinDock(window.siyuan.layout.leftDock, "iconLeftTop"));
            dockMenu.push(togglePinDock(window.siyuan.layout.rightDock, "iconRightTop"));
            dockMenu.push(togglePinDock(window.siyuan.layout.bottomDock, "iconBottomLeft"));
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.panels,
            icon: "iconDock",
            type: "submenu",
            submenu: dockMenu
        }).element);
        /// #if !BROWSER
        const workspaceSubMenu: IMenu[] = [{
            label: window.siyuan.languages.openBy + "...",
            iconHTML: Constants.ZWSP,
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
        }];
        workspaceSubMenu.push({type: "separator"});
        response.data.forEach((item: IWorkspace) => {
            workspaceSubMenu.push(workspaceItem(item) as IMenu);
        });
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.workspaceList,
            icon: "iconWorkspace",
            type: "submenu",
            submenu: workspaceSubMenu,
        }).element);
        /// #endif
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
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
                            label: escapeHtml(item.name),
                            iconHTML: unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE, false, "b3-menu__icon", true),
                            accelerator: window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] === item.id ? window.siyuan.config.keymap.general.dailyNote.custom : "",
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
                    type: "submenu",
                    submenu
                }).element);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.riffCard,
                type: "submenu",
                icon: "iconRiffCard",
                submenu: [{
                    iconHTML: Constants.ZWSP,
                    label: window.siyuan.languages.spaceRepetition,
                    accelerator: window.siyuan.config.keymap.general.riffCard.custom,
                    click: () => {
                        openCard();
                    }
                }, {
                    iconHTML: Constants.ZWSP,
                    label: window.siyuan.languages.mgmt,
                    click: () => {
                        viewCards("", window.siyuan.languages.all, "");
                    }
                }],
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.lockScreen,
            icon: "iconLock",
            accelerator: window.siyuan.config.keymap.general.lockScreen.custom,
            click: () => {
                lockScreen();
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.dataHistory,
            icon: "iconHistory",
            accelerator: window.siyuan.config.keymap.general.dataHistory.custom,
            click: () => {
                openHistory();
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.help,
            icon: "iconHelp",
            click: () => {
                mountHelp();
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.feedback,
            icon: "iconHeart",
            click: () => {
                if ("zh_CN" === window.siyuan.config.lang) {
                    window.open("https://ld246.com/article/1649901726096");
                } else {
                    window.open("https://github.com/siyuan-note/siyuan/issues");
                }
            }
        }).element);
        /// #if !BROWSER
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.debug,
            icon: "iconBug",
            click: () => {
                getCurrentWindow().webContents.openDevTools({mode: "bottom"});
            }
        }).element);
        /// #endif
        window.siyuan.menus.menu.popup({x: rect.left, y: rect.bottom});
    });
};

const openWorkspace = (workspace: string) => {
    /// #if !BROWSER
    if (workspace === window.siyuan.config.system.workspaceDir) {
        return;
    }
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

const workspaceItem = (item: IWorkspace) => {
    /// #if !BROWSER
    return {
        label: `<div data-type="a" aria-label="${item.path}" class="fn__ellipsis" style="max-width: 256px">
    ${originalPath().basename(item.path)}
</div>`,
        current: !item.closed,
        iconHTML: Constants.ZWSP,
        type: "submenu",
        submenu: [{
            label: window.siyuan.languages.openBy,
            click() {
                openWorkspace(item.path);
            }
        }, {
            label: window.siyuan.languages.showInFolder,
            click() {
                shell.showItemInFolder(item.path);
            }
        }, {
            label: window.siyuan.languages.copyPath,
            click() {
                writeText(item.path);
                showMessage(window.siyuan.languages.copied);
            }
        }, {
            label: window.siyuan.languages.removeWorkspaceTip,
            click() {
                fetchPost("/api/system/removeWorkspaceDir", {path: item.path});
            }
        }],
        click() {
            openWorkspace(item.path);
        },
    };
    /// #endif
};
