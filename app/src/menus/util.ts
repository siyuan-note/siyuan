/// #if !BROWSER
import {ipcRenderer} from "electron";
import * as path from "path";
/// #endif
import {fetchPost} from "../util/fetch";
import {getAssetName, pathPosix, showFileInFolder} from "../util/pathName";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";
import {openNewWindowById} from "../window/openNewWindow";
import {MenuItem} from "./Menu";
import {App} from "../index";
import {isInAndroid, openByMobile, updateHotkeyTip} from "../protyle/util/compatibility";
import {checkFold} from "../util/noRelyPCFunction";

export const exportAsset = (src: string) => {
    return {
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        async click() {
            /// #if BROWSER
            openByMobile(src);
            /// #else
            const result = await ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "showSaveDialog",
                defaultPath: getAssetName(src) + pathPosix().extname(src),
                properties: ["showOverwriteConfirmation"],
            });
            if (!result.canceled) {
                fetchPost("/api/file/copyFile", {src, dest: result.filePath});
            }
            /// #endif
        }
    };
};

export const openEditorTab = (app: App, ids: string[], notebookId?: string, pathString?: string) => {
    /// #if !MOBILE
    const openSubmenus: IMenu[] = [{
        icon: "iconLayoutRight",
        label: window.siyuan.languages.insertRight,
        accelerator: ids.length === 1 ? `${updateHotkeyTip(window.siyuan.config.keymap.editor.general.insertRight.custom)}/${updateHotkeyTip("⌥" + window.siyuan.languages.click)}` : undefined,
        click: () => {
            if (notebookId) {
                openFileById({
                    app,
                    id: ids[0],
                    position: "right",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                });
            } else {
                ids.forEach((id) => {
                    checkFold(id, (zoomIn, action) => {
                        openFileById({
                            app,
                            id,
                            position: "right",
                            action,
                            zoomIn
                        });
                    });
                });
            }
        }
    }, {
        icon: "iconLayoutBottom",
        label: window.siyuan.languages.insertBottom,
        accelerator: ids.length === 1 ? "⇧" + window.siyuan.languages.click : "",
        click: () => {
            if (notebookId) {
                openFileById({
                    app,
                    id: ids[0],
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                });
            } else {
                ids.forEach((id) => {
                    checkFold(id, (zoomIn, action) => {
                        openFileById({
                            app,
                            id,
                            position: "bottom",
                            action,
                            zoomIn
                        });
                    });
                });
            }
        }
    }];
    if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
        openSubmenus.push({
            label: window.siyuan.languages.openInNewTab,
            accelerator: ids.length === 1 ? "⌥⌘" + window.siyuan.languages.click : undefined,
            click: () => {
                if (notebookId) {
                    openFileById({
                        app,
                        id: ids[0],
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                        removeCurrentTab: false
                    });
                } else {
                    ids.forEach((id) => {
                        checkFold(id, (zoomIn, action) => {
                            openFileById({
                                app,
                                id,
                                action,
                                zoomIn,
                                removeCurrentTab: false
                            });
                        });
                    });
                }
            }
        });
    }
    /// #if !BROWSER
    openSubmenus.push({
        label: window.siyuan.languages.openByNewWindow,
        icon: "iconOpenWindow",
        click() {
            ids.forEach((id) => {
                openNewWindowById(id);
            });
        }
    });
    /// #endif
    openSubmenus.push({type: "separator"});
    openSubmenus.push({
        icon: "iconPreview",
        label: window.siyuan.languages.preview,
        click: () => {
            ids.forEach((id) => {
                openFileById({app, id, mode: "preview"});
            });
        }
    });
    /// #if !BROWSER
    openSubmenus.push({type: "separator"});
    openSubmenus.push({
        icon: "iconFolder",
        label: window.siyuan.languages.showInFolder,
        click: () => {
            if (notebookId) {
                showFileInFolder(path.join(window.siyuan.config.system.dataDir, notebookId, pathString));
            } else {
                ids.forEach((id) => {
                    fetchPost("/api/block/getBlockInfo", {id}, (response) => {
                        showFileInFolder(path.join(window.siyuan.config.system.dataDir, response.data.box, response.data.path));
                    });
                });
            }
        }
    });
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.openBy,
        icon: "iconOpen",
        submenu: openSubmenus,
    }).element);
    /// #endif
};

export const copyPNGByLink = (link:string) => {
    if (isInAndroid()) {
        window.JSAndroid.writeImageClipboard(link);
        return;
    } else {
        const canvas = document.createElement("canvas");
        const tempElement = document.createElement("img");
        tempElement.onload = (e: Event & { target: HTMLImageElement }) => {
            canvas.width = e.target.width;
            canvas.height = e.target.height;
            canvas.getContext("2d").drawImage(e.target, 0, 0, e.target.width, e.target.height);
            canvas.toBlob((blob) => {
                navigator.clipboard.write([
                    new ClipboardItem({
                        // @ts-ignore
                        ["image/png"]: blob
                    })
                ]);
            }, "image/png", 1);
        };
        tempElement.src = link;
    }
};

