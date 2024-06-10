import {MenuItem} from "./Menu";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {openHistory} from "../history/history";
import {getOpenNotebookCount, originalPath, pathPosix, showFileInFolder} from "../util/pathName";
import {fetchNewDailyNote, mountHelp, newDailyNote} from "../util/mount";
import {fetchPost} from "../util/fetch";
import {Constants} from "../constants";
import {isInAndroid, isInIOS, isIPad, setStorageVal, writeText} from "../protyle/util/compatibility";
import {openCard} from "../card/openCard";
import {openSetting} from "../config";
import {getAllDocks} from "../layout/getAll";
import {exportLayout, getAllLayout} from "../layout/util";
import {getDockByType} from "../layout/tabUtil";
import {exitSiYuan, lockScreen} from "../dialog/processSystem";
import {showMessage} from "../dialog/message";
import {unicode2Emoji} from "../emoji";
import {Dock} from "../layout/dock";
import {escapeHtml} from "../util/escape";
import {viewCards} from "../card/viewCards";
import {Dialog} from "../dialog";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {confirmDialog} from "../dialog/confirmDialog";
import {App} from "../index";
import {isBrowser} from "../util/functions";
import {openRecentDocs} from "../business/openRecentDocs";
import * as dayjs from "dayjs";

const editLayout = (layoutName?: string) => {
    const dialog = new Dialog({
        positionId: Constants.DIALOG_SAVEWORKSPACE,
        title: layoutName ? window.siyuan.languages.edit : window.siyuan.languages.save,
        content: `<div class="b3-dialog__content">
        <input class="b3-text-field fn__block" value="${layoutName || ""}" placeholder="${window.siyuan.languages.memo}">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--error${layoutName ? "" : " fn__none"}">${window.siyuan.languages.delete}</button><div class="fn__space"></div>   
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text${layoutName ? "" : " fn__none"}">${window.siyuan.languages.rename}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages[layoutName ? "updateLayout" : "confirm"]}</button>
</div>`,
        width: "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_SAVEWORKSPACE);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    const inputElement = dialog.element.querySelector("input");
    inputElement.select();
    inputElement.focus();
    dialog.bindInput(inputElement, () => {
        btnsElement[3].dispatchEvent(new CustomEvent("click"));
    });
    btnsElement[0].addEventListener("click", () => {
        window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((layoutItem: ISaveLayout, index: number) => {
            if (layoutItem.name === layoutName) {
                window.siyuan.storage[Constants.LOCAL_LAYOUTS].splice(index, 1);
                setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                return true;
            }
        });
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[2].addEventListener("click", () => {
        const value = inputElement.value;
        if (!value) {
            showMessage(window.siyuan.languages["_kernel"]["142"]);
            return;
        }
        dialog.destroy();
        window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((layoutItem: ISaveLayout) => {
            if (layoutItem.name === layoutName) {
                layoutItem.name = value;
                layoutItem.time = new Date().getTime();
                setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                return true;
            }
        });
    });
    btnsElement[3].addEventListener("click", () => {
        const value = inputElement.value;
        if (!value) {
            showMessage(window.siyuan.languages["_kernel"]["142"]);
            return;
        }
        dialog.destroy();
        if (layoutName) {
            window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((layoutItem: ISaveLayout) => {
                if (layoutItem.name === layoutName) {
                    layoutItem.name = value;
                    layoutItem.time = new Date().getTime();
                    layoutItem.layout = getAllLayout();
                    setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                    return true;
                }
            });
            return;
        }
        const hadName = window.siyuan.storage[Constants.LOCAL_LAYOUTS].find((item: ISaveLayout) => {
            if (item.name === value) {
                confirmDialog(window.siyuan.languages.save, window.siyuan.languages.exportTplTip, () => {
                    item.layout = getAllLayout();
                    item.time = new Date().getTime();
                    setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
                });
                return true;
            }
        });
        if (hadName) {
            return;
        }
        window.siyuan.storage[Constants.LOCAL_LAYOUTS].push({
            name: value,
            time: new Date().getTime(),
            layout: getAllLayout()
        });
        setStorageVal(Constants.LOCAL_LAYOUTS, window.siyuan.storage[Constants.LOCAL_LAYOUTS]);
    });
};

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

export const workspaceMenu = (app: App, rect: DOMRect) => {
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
                    openSetting(app);
                }
            }).element);
        }
        const dockMenu: IMenu[] = [];
        getAllDocks().forEach(item => {
            dockMenu.push({
                icon: item.icon,
                accelerator: item.hotkey,
                label: item.title,
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
        if (!window.siyuan.config.readonly) {
            let workspaceSubMenu: IMenu[];
            /// #if !BROWSER
            workspaceSubMenu = [{
                label: `${window.siyuan.languages.new} / ${window.siyuan.languages.openBy}`,
                iconHTML: "",
                click: async () => {
                    const localPath = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                        cmd: "showOpenDialog",
                        defaultPath: window.siyuan.config.system.homeDir,
                        properties: ["openDirectory", "createDirectory"],
                    });
                    if (localPath.filePaths.length === 0) {
                        return;
                    }
                    fetchPost("/api/system/checkWorkspaceDir", {path: localPath.filePaths[0]}, (response) => {
                        if (response.data.isWorkspace) {
                            openWorkspace(localPath.filePaths[0]);
                        } else {
                            confirmDialog("🏗️ " + window.siyuan.languages.createWorkspace, window.siyuan.languages.createWorkspaceTip + `<br><br><code class="fn__code">${localPath.filePaths[0]}</code>`, () => {
                                openWorkspace(localPath.filePaths[0]);
                            });
                        }
                    });
                }
            }];
            workspaceSubMenu.push({type: "separator"});
            response.data.forEach((item: IWorkspace) => {
                workspaceSubMenu.push(workspaceItem(item) as IMenu);
            });
            /// #else
            workspaceSubMenu = [{
                label: window.siyuan.languages.new,
                iconHTML: "",
                click() {
                    const createWorkspaceDialog = new Dialog({
                        title: window.siyuan.languages.new,
                        content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                        width: "520px",
                    });
                    createWorkspaceDialog.element.setAttribute("data-key", Constants.DIALOG_CREATEWORKSPACE);
                    const inputElement = createWorkspaceDialog.element.querySelector("input");
                    inputElement.focus();
                    const btnsElement = createWorkspaceDialog.element.querySelectorAll(".b3-button");
                    btnsElement[0].addEventListener("click", () => {
                        createWorkspaceDialog.destroy();
                    });
                    btnsElement[1].addEventListener("click", () => {
                        fetchPost("/api/system/createWorkspaceDir", {
                            path: pathPosix().join(pathPosix().dirname(window.siyuan.config.system.workspaceDir), inputElement.value)
                        }, () => {
                            createWorkspaceDialog.destroy();
                        });
                    });
                }
            }, {
                label: `${window.siyuan.languages.openBy}...`,
                iconHTML: "",
                click() {
                    fetchPost("/api/system/getMobileWorkspaces", {}, (response) => {
                        let selectHTML = "";
                        response.data.forEach((item: string, index: number) => {
                            selectHTML += `<option value="${item}"${index === 0 ? ' selected="selected"' : ""}>${pathPosix().basename(item)}</option>`;
                        });
                        const openWorkspaceDialog = new Dialog({
                            title: window.siyuan.languages.openBy,
                            content: `<div class="b3-dialog__content">
    <select class="b3-text-field fn__block">${selectHTML}</select>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                            width: "520px",
                        });
                        openWorkspaceDialog.element.setAttribute("data-key", Constants.DIALOG_OPENWORKSPACE);
                        const btnsElement = openWorkspaceDialog.element.querySelectorAll(".b3-button");
                        btnsElement[0].addEventListener("click", () => {
                            openWorkspaceDialog.destroy();
                        });
                        btnsElement[1].addEventListener("click", () => {
                            const openPath = openWorkspaceDialog.element.querySelector("select").value;
                            if (openPath === window.siyuan.config.system.workspaceDir) {
                                openWorkspaceDialog.destroy();
                                return;
                            }
                            confirmDialog(window.siyuan.languages.confirm, `${pathPosix().basename(window.siyuan.config.system.workspaceDir)} -> ${pathPosix().basename(openPath)}?`, () => {
                                fetchPost("/api/system/setWorkspaceDir", {
                                    path: openPath
                                }, () => {
                                    exitSiYuan();
                                });
                            });
                        });
                    });
                }
            }];
            workspaceSubMenu.push({type: "separator"});
            response.data.forEach((item: IWorkspace) => {
                workspaceSubMenu.push({
                    iconHTML: "",
                    action: "iconCloseRound",
                    current: window.siyuan.config.system.workspaceDir === item.path,
                    label: pathPosix().basename(item.path),
                    bind(menuElement) {
                        menuElement.addEventListener("click", (event) => {
                            if (hasClosestByClassName(event.target as Element, "b3-menu__action")) {
                                event.preventDefault();
                                event.stopPropagation();
                                fetchPost("/api/system/removeWorkspaceDir", {path: item.path}, () => {
                                    confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.removeWorkspacePhysically.replace("${x}", item.path), () => {
                                        fetchPost("/api/system/removeWorkspaceDirPhysically", {path: item.path});
                                    });
                                });
                                return;
                            }
                            confirmDialog(window.siyuan.languages.confirm, `${pathPosix().basename(window.siyuan.config.system.workspaceDir)} -> ${pathPosix().basename(item.path)}?`, () => {
                                fetchPost("/api/system/setWorkspaceDir", {
                                    path: item.path
                                }, () => {
                                    exitSiYuan();
                                });
                            });
                        });
                    }
                });
            });
            /// #endif
            if (!isBrowser() || isInIOS() || isInAndroid()) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.workspaceList,
                    icon: "iconWorkspace",
                    type: "submenu",
                    submenu: workspaceSubMenu,
                }).element);
            }
        }
        const layoutSubMenu: IMenu[] = [{
            iconHTML: "",
            label: window.siyuan.languages.save,
            click() {
                editLayout();
            }
        }];
        if (window.siyuan.storage[Constants.LOCAL_LAYOUTS].length > 0) {
            layoutSubMenu.push({type: "separator"});
        }
        window.siyuan.storage[Constants.LOCAL_LAYOUTS].forEach((item: ISaveLayout) => {
            layoutSubMenu.push({
                iconHTML: "",
                action: "iconEdit",
                label: `${item.name} <span class="ft__smaller ft__on-surface">${item.time ? dayjs(item.time).format("YYYY-MM-DD HH:mm") : ""}</span>`,
                bind(menuElement) {
                    menuElement.addEventListener("click", (event) => {
                        if (hasClosestByClassName(event.target as Element, "b3-menu__action")) {
                            event.preventDefault();
                            event.stopPropagation();
                            editLayout(item.name);
                            window.siyuan.menus.menu.remove();
                            return;
                        }
                        if (window.siyuan.config.readonly) {
                            window.location.reload();
                        } else {
                            fetchPost("/api/system/setUILayout", {layout: item.layout}, () => {
                                window.location.reload();
                            });
                        }
                    });
                }
            });
        });
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.layout,
            icon: "iconLayout",
            type: "submenu",
            submenu: layoutSubMenu
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        if (!window.siyuan.config.readonly) {
            if (getOpenNotebookCount() < 2) {
                window.siyuan.menus.menu.append(new MenuItem({
                    label: window.siyuan.languages.dailyNote,
                    icon: "iconCalendar",
                    accelerator: window.siyuan.config.keymap.general.dailyNote.custom,
                    click: () => {
                        newDailyNote(app);
                    }
                }).element);
            } else {
                const submenu: IMenu[] = [];
                window.siyuan.notebooks.forEach(item => {
                    if (!item.closed) {
                        submenu.push({
                            label: escapeHtml(item.name),
                            iconHTML: unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE, "b3-menu__icon", true),
                            accelerator: window.siyuan.storage[Constants.LOCAL_DAILYNOTEID] === item.id ? window.siyuan.config.keymap.general.dailyNote.custom : "",
                            click: () => {
                                fetchNewDailyNote(app, item.id);
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
                    iconHTML: "",
                    label: window.siyuan.languages.spaceRepetition,
                    accelerator: window.siyuan.config.keymap.general.riffCard.custom,
                    click: () => {
                        openCard(app);
                    }
                }, {
                    iconHTML: "",
                    label: window.siyuan.languages.manage,
                    click: () => {
                        viewCards(app, "", window.siyuan.languages.all, "");
                    }
                }],
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.recentDocs,
                icon: "iconFile",
                accelerator: window.siyuan.config.keymap.general.recentDocs.custom,
                click: () => {
                    openRecentDocs();
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.lockScreen,
                icon: "iconLock",
                accelerator: window.siyuan.config.keymap.general.lockScreen.custom,
                click: () => {
                    lockScreen(app);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.dataHistory,
                icon: "iconHistory",
                accelerator: window.siyuan.config.keymap.general.dataHistory.custom,
                click: () => {
                    openHistory(app);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
        if (!isIPad()) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.userGuide,
                icon: "iconHelp",
                click: () => {
                    mountHelp();
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.feedback,
            icon: "iconFeedback",
            click: () => {
                if ("zh_CN" === window.siyuan.config.lang || "zh_CHT" === window.siyuan.config.lang) {
                    window.open("https://ld246.com/article/1649901726096");
                } else {
                    window.open("https://liuyun.io/article/1686530886208");
                }
            }
        }).element);
        /// #if !BROWSER
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.debug,
            icon: "iconBug",
            click: () => {
                ipcRenderer.send(Constants.SIYUAN_CMD, "openDevTools");
            }
        }).element);
        /// #endif
        if (isIPad() || isInAndroid() || !isBrowser()) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.safeQuit,
                icon: "iconQuit",
                click: () => {
                    exportLayout({
                        errorExit: true,
                        cb: exitSiYuan,
                    });
                }
            }).element);
        }
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
        label: `<div aria-label="${item.path}" class="fn__ellipsis ariaLabel" style="max-width: 256px">
    ${originalPath().basename(item.path)}
</div>`,
        current: !item.closed,
        iconHTML: "",
        type: "submenu",
        submenu: [{
            icon: "iconOpenWindow",
            label: window.siyuan.languages.openBy,
            click() {
                openWorkspace(item.path);
            }
        }, {
            icon: "iconFolder",
            label: window.siyuan.languages.showInFolder,
            click() {
                showFileInFolder(item.path);
            }
        }, {
            icon: "iconCopy",
            label: window.siyuan.languages.copyPath,
            click() {
                writeText(item.path);
                showMessage(window.siyuan.languages.copied);
            }
        }, {
            icon: "iconTrashcan",
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
