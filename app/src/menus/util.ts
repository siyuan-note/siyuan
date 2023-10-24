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
import {isInAndroid, updateHotkeyTip} from "../protyle/util/compatibility";

export const exportAsset = (src: string) => {
    /// #if !BROWSER
    return {
        label: window.siyuan.languages.export,
        icon: "iconUpload",
        async click() {
            const result = await ipcRenderer.invoke(Constants.SIYUAN_GET,{
                cmd: "showSaveDialog",
                defaultPath: getAssetName(src) + pathPosix().extname(src),
                properties: ["showOverwriteConfirmation"],
            });
            if (!result.canceled) {
                fetchPost("/api/file/copyFile", {src, dest: result.filePath});
            }
        }
    };
    /// #endif
};


export const openEditorTab = (app: App, id: string, notebookId?: string, pathString?: string) => {
    /// #if !MOBILE
    const openSubmenus: IMenu[] = [{
        icon: "iconLayoutRight",
        label: window.siyuan.languages.insertRight,
        accelerator: `${updateHotkeyTip(window.siyuan.config.keymap.editor.general.insertRight.custom)}/${updateHotkeyTip("⌥Click")}`,
        click: () => {
            if (notebookId) {
                openFileById({app, id, position: "right", action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]});
            } else {
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app,
                        id,
                        position: "right",
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: foldResponse.data
                    });
                });
            }
        }
    }, {
        icon: "iconLayoutBottom",
        label: window.siyuan.languages.insertBottom,
        accelerator: "⇧Click",
        click: () => {
            if (notebookId) {
                openFileById({app, id, position: "bottom", action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]});
            } else {
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app,
                        id,
                        position: "bottom",
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn: foldResponse.data
                    });
                });
            }
        }
    }];
    if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
        openSubmenus.push({
            label: window.siyuan.languages.openInNewTab,
            accelerator: "⌥⌘Click",
            click: () => {
                if (notebookId) {
                    openFileById({app, id, action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL], removeCurrentTab: false});
                } else {
                    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                        openFileById({
                            app,
                            id,
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                            zoomIn: foldResponse.data,
                            removeCurrentTab: false
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
            openNewWindowById(id);
        }
    });
    /// #endif
    openSubmenus.push({type: "separator"});
    openSubmenus.push({
        icon: "iconPreview",
        label: window.siyuan.languages.preview,
        click: () => {
            openFileById({app, id, mode: "preview"});
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
                fetchPost("/api/block/getBlockInfo", {id}, (response) => {
                    showFileInFolder(path.join(window.siyuan.config.system.dataDir, response.data.box, response.data.path));
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

export const copyPNG = (imgElement: HTMLImageElement) => {
    if (isInAndroid()) {
        window.JSAndroid.writeImageClipboard(imgElement.getAttribute("src"));
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
        tempElement.src = imgElement.getAttribute("src");
    }
};
