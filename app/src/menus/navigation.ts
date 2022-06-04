import {
    copySubMenu,
    deleteMenu,
    exportMd,
    movePathToMenu,
    newFileMenu,
    openFileAttr,
    renameMenu,
} from "./commonMenuItem";
/// #if !BROWSER
import {FileFilter, shell} from "electron";
import {dialog as remoteDialog} from "@electron/remote";
import * as path from "path";
/// #endif
import {MenuItem} from "./Menu";
import {getDisplayName, getNotebookName, pathPosix} from "../util/pathName";
import {hideMessage, showMessage} from "../dialog/message";
import {fetchPost} from "../util/fetch";
import {onGetnotebookconf} from "./onGetnotebookconf";
/// #if !MOBILE
import {openSearch} from "../search/spread";
/// #endif
import {confirmDialog} from "../dialog/confirmDialog";
import {isMobile} from "../util/functions";
import {Constants} from "../constants";
import {openFileById} from "../editor/util";

export const initNavigationMenu = (liElement: HTMLElement) => {
    const notebookId = liElement.parentElement.getAttribute("data-url");
    const name = getNotebookName(notebookId);
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.append(newFileMenu(notebookId, "/", true));
    /// #if !BROWSER
    genImportMenu(notebookId, "/");
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(renameMenu({
            path: "/",
            notebookId,
            name,
            type: "notebook"
        }));
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.config,
        icon: "iconSettings",
        click: () => {
            fetchPost("/api/notebook/getNotebookConf", {
                notebook: notebookId
            }, (data) => {
                onGetnotebookconf(data.data);
            });
        }
    }).element);
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.search,
        accelerator: window.siyuan.config.keymap.general.search.custom,
        icon: "iconSearch",
        click() {
            openSearch(window.siyuan.config.keymap.general.search.custom, undefined, notebookId);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.replace,
        accelerator: window.siyuan.config.keymap.general.replace.custom,
        click() {
            openSearch(window.siyuan.config.keymap.general.replace.custom, undefined, notebookId);
        }
    }).element);
    /// #endif
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.close,
            icon: "iconClose",
            click: () => {
                fetchPost("/api/notebook/closeNotebook", {
                    notebook: notebookId
                });
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconTrashcan",
            label: window.siyuan.languages.delete,
            accelerator: "⌦",
            click: () => {
                confirmDialog(window.siyuan.languages.delete,
                    `${window.siyuan.languages.confirmDelete} <b>${Lute.EscapeHTMLStr(name)}</b>?`, () => {
                        fetchPost("/api/notebook/removeNotebook", {
                            notebook: notebookId,
                            callback: Constants.CB_MOUNT_REMOVE
                        });
                    });
            }
        }).element);
    }
    /// #if !BROWSER
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.showInFolder,
        click: () => {
            shell.openPath(pathPosix().join(window.siyuan.config.system.dataDir, notebookId));
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        click: () => {
            const id = showMessage(window.siyuan.languages.exporting, -1);
            fetchPost("/api/export/batchExportMd", {
                notebook: notebookId,
                path: "/"
            }, response => {
                hideMessage(id);
                window.open(response.data.zip);
            });
        }
    }).element);
    /// #endif
    return window.siyuan.menus.menu;
};

export const initFileMenu = (notebookId: string, pathString: string, id: string, name: string) => {
    window.siyuan.menus.menu.remove();
    name = getDisplayName(name, false, true);
    if (!window.siyuan.config.readonly) {
        window.siyuan.menus.menu.append(newFileMenu(notebookId, pathString, true));
        genImportMenu(notebookId, pathString);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            type: "submenu",
            icon: "iconCopy",
            submenu: (copySubMenu(id, "", false) as IMenu[]).concat([{
                label: window.siyuan.languages.duplicate,
                click() {
                    fetchPost("/api/filetree/duplicateDoc", {
                        id
                    });
                }
            }])
        }).element);
        if (!isMobile()) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.attr,
                click() {
                    fetchPost("/api/block/getDocInfo", {
                        id
                    }, (response) => {
                        openFileAttr(response.data.ial, id);
                    });
                }
            }).element);
        }
        window.siyuan.menus.menu.append(renameMenu({
            path: pathString,
            notebookId,
            name,
            type: "file"
        }));
        window.siyuan.menus.menu.append(movePathToMenu(notebookId, pathString));
        /// #if !MOBILE
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.search,
            icon: "iconSearch",
            accelerator: window.siyuan.config.keymap.general.search.custom,
            click() {
                openSearch(window.siyuan.config.keymap.general.search.custom, undefined, notebookId, getDisplayName(pathString, false, true));
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.replace,
            accelerator: window.siyuan.config.keymap.general.replace.custom,
            click() {
                openSearch(window.siyuan.config.keymap.general.replace.custom, undefined, notebookId, getDisplayName(pathString, false, true));
            }
        }).element);
        /// #endif
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(deleteMenu(notebookId, name, pathString));
        if (!isMobile()) {
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        }
    }
    const openSubmenus: IMenu[] = [{
        icon: "iconRight",
        label: window.siyuan.languages.insertRight,
        accelerator: "⌥Click",
        click: () => {
            openFileById({id, position: "right", action: [Constants.CB_GET_FOCUS]});
        }
    }, {
        icon: "iconDown",
        label: window.siyuan.languages.insertBottom,
        click: () => {
            openFileById({id, position: "bottom", action: [Constants.CB_GET_FOCUS]});
        }
    }];
    if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
        openSubmenus.push({
            label: window.siyuan.languages.openInNewTab,
            accelerator: "⌘Click",
            click: () => {
                window.siyuan.ctrlIsPressed = true;
                openFileById({id, action: [Constants.CB_GET_FOCUS]});
                setTimeout(() => {
                    // 勾选在当前页签中打开后，右键在新页签中打开，不重置的话后续点击都会打开新页签
                    window.siyuan.ctrlIsPressed = false;
                }, Constants.TIMEOUT_INPUT);
            }
        });
    }
    openSubmenus.push({type: "separator"});
    openSubmenus.push({
        icon: "iconPreview",
        label: window.siyuan.languages.preview,
        click: () => {
            openFileById({id, mode: "preview"});
        }
    });
    /// #if !BROWSER
    openSubmenus.push({type: "separator"});
    if (!window.siyuan.config.readonly) {
        openSubmenus.push({
            label: window.siyuan.languages.showInFolder,
            click: () => {
                shell.showItemInFolder(path.join(window.siyuan.config.system.dataDir, notebookId, pathString));
            }
        });
    }
    /// #endif
    if (!isMobile()) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.openBy,
            submenu: openSubmenus,
        }).element);
    }
    window.siyuan.menus.menu.append(exportMd(id));
    return window.siyuan.menus.menu;
};

const genImportMenu = (notebookId: string, pathString: string) => {
    /// #if !BROWSER
    if (!window.siyuan.config.readonly) {
        const importstdmd = (label: string, isDoc?: boolean) => {
            return {
                icon: isDoc ? "iconMarkdown" : "iconFolder",
                label,
                click: async () => {
                    let filters: FileFilter[] = [];
                    if (isDoc) {
                        filters = [{name: "Markdown", extensions: ["md", "markdown"]}];
                    }
                    const localPath = await remoteDialog.showOpenDialog({
                        defaultPath: window.siyuan.config.system.homeDir,
                        filters,
                        properties: [isDoc ? "openFile" : "openDirectory"],
                    });
                    if (localPath.filePaths.length === 0) {
                        return;
                    }
                    fetchPost("/api/import/importStdMd", {
                        notebook: notebookId,
                        localPath: localPath.filePaths[0],
                        toPath: pathString,
                    });
                }
            };
        };
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconDownload",
            label: window.siyuan.languages.import,
            submenu: [{
                icon: "iconSiYuan",
                label: 'SiYuan .sy.zip<input class="b3-form__upload" type="file" accept="application/zip">',
                bind: (element) => {
                    element.querySelector(".b3-form__upload").addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                        const formData = new FormData();
                        formData.append("file", event.target.files[0]);
                        formData.append("notebook", notebookId);
                        formData.append("toPath", pathString);
                        fetchPost("/api/import/importSY", formData);
                    });
                }
            },
                importstdmd("Markdown " + window.siyuan.languages.doc, true),
                importstdmd("Markdown " + window.siyuan.languages.folder)],
        }).element);
    }
    /// #endif
};
