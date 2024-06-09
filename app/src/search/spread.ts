import {getNotebookName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {genSearch, updateConfig} from "./util";
import {App} from "../index";

export const openSearch = async (options: {
    app: App,
    hotkey: string,
    key?: string,
    notebookId?: string,
    searchPath?: string
}) => {
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
    let hPath = "";
    let idPath: string[] = [];
    if (options.notebookId) {
        hPath = getNotebookName(options.notebookId);
        idPath.push(options.notebookId);
        if (options.searchPath && options.searchPath !== "/") {
            const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                notebook: options.notebookId,
                path: options.searchPath.endsWith(".sy") ? options.searchPath : options.searchPath + ".sy"
            });
            hPath = pathPosix().join(hPath, response.data);
            idPath[0] = pathPosix().join(idPath[0], options.searchPath);
        }
    } else if (Constants.DIALOG_GLOBALSEARCH === options.hotkey) {
        if (localData.removed) {
            hPath = "";
            idPath = [];
        } else {
            hPath = localData.hPath;
            idPath = localData.idPath;
        }
    }
    const config = {
        removed: localData.removed,
        k: options.key || localData.k,
        r: localData.r,
        hasReplace: options.hotkey === Constants.DIALOG_REPLACE,
        method: localData.method,
        hPath,
        idPath,
        group: localData.group,
        sort: localData.sort,
        types: Object.assign({}, localData.types),
        replaceTypes: Object.assign({}, localData.replaceTypes),
        page: options.key ? 1 : localData.page
    };
    // 搜索中继续执行 ctrl+F/P 不退出 https://github.com/siyuan-note/siyuan/issues/11637
    const exitDialog = window.siyuan.dialogs.find((item) => {
        // 再次打开
        if (item.element.querySelector("#searchList")) {
            const searchElement = item.element.querySelector(".b3-dialog__body")
            const cloneData = JSON.parse(JSON.stringify(item.data)) as Config.IUILayoutTabSearchConfig;
            const selectText = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0).toString() : undefined;
            if (selectText) {
                cloneData.k = selectText;
            }
            item.element.setAttribute("data-key", options.hotkey);
            if (options.hotkey === Constants.DIALOG_REPLACE) {
                cloneData.hasReplace = true;
                updateConfig(searchElement, cloneData, item.data, item.editors.edit);
            } else if (options.hotkey === Constants.DIALOG_GLOBALSEARCH) {
                cloneData.hasReplace = false;
                cloneData.hPath = "";
                cloneData.idPath = [];
                updateConfig(searchElement, cloneData, item.data, item.editors.edit);
            } else if (options.hotkey === Constants.DIALOG_SEARCH) {
                cloneData.hasReplace = false;
                const toPath = item.editors.edit.protyle.path
                fetchPost("/api/filetree/getHPathsByPaths", {paths: [toPath]}, (response) => {
                    cloneData.idPath = [pathPosix().join(item.editors.edit.protyle.notebookId, toPath)];
                    cloneData.hPath = response.data[0];
                    item.data.idPath = cloneData.idPath
                    item.data.hPath = cloneData.hPath
                    updateConfig(searchElement, cloneData, item.data, item.editors.edit);
                });
            }
            return true;
        }
    });
    if (exitDialog) {
        return;
    }
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    const dialog = new Dialog({
        positionId: options.hotkey,
        content: "",
        width: "80vw",
        height: "90vh",
        destroyCallback(options: IObject) {
            if (range && !options) {
                focusByRange(range);
            }
            dialog.editors.edit.destroy();
            dialog.editors.unRefEdit.destroy();
        },
        resizeCallback(type: string) {
            if (type !== "d" && type !== "t") {
                if (dialog.element.querySelector("#searchUnRefPanel").classList.contains("fn__none")) {
                    dialog.editors.edit.resize();
                } else {
                    dialog.editors.unRefEdit.resize();
                }
            }
        }
    });
    dialog.element.setAttribute("data-key", options.hotkey);
    dialog.editors = genSearch(options.app, config, dialog.element.querySelector(".b3-dialog__body"), () => {
        dialog.destroy({focus: "false"});
    });
    dialog.data = config;
};
