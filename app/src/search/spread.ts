import {getNotebookName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {genSearch, updateConfig} from "./util";
import type {App} from "../index";
import {cancelSearchRequest} from "./request";
import {
    hasExplicitSearchScope,
    replaceSearchConfigPath,
    resolveGlobalSearchScope,
    setSearchConfigTemporaryPath,
} from "./config";
import {beginSearchPathRequest} from "./path";

let openSearchVersion = 0;

export const openSearch = async (options: {
    app: App,
    hotkey: string,
    key?: string,
    notebookId?: string,
    notebookIds?: string[],
    searchPath?: string
}) => {
    const version = ++openSearchVersion;
    const existingSearchDialog = window.siyuan.dialogs.find((item) => item.element.querySelector("#searchList"));
    const existingSearchElement = existingSearchDialog?.element.querySelector(".b3-dialog__body");
    const isCurrentPathRequest = existingSearchElement ? beginSearchPathRequest(existingSearchElement) : undefined;
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
    const hasScopedPath = hasExplicitSearchScope(options);
    let hPath = "";
    let idPath: string[] = [];
    if (options.notebookIds?.length) {
        idPath = [...options.notebookIds];
        hPath = options.notebookIds.map((notebookId) => getNotebookName(notebookId)).join(" ");
    } else if (options.notebookId) {
        hPath = getNotebookName(options.notebookId);
        idPath.push(options.notebookId);
        if (options.searchPath && options.searchPath !== "/") {
            const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                notebook: options.notebookId,
                path: options.searchPath.endsWith(".sy") ? options.searchPath : options.searchPath + ".sy"
            });
            if (version !== openSearchVersion || (isCurrentPathRequest && !isCurrentPathRequest())) {
                return;
            }
            if (response.code !== 0 || typeof response.data !== "string") {
                return;
            }
            hPath = pathPosix().join(hPath, response.data);
            idPath[0] = pathPosix().join(idPath[0], options.searchPath);
        }
    } else if (Constants.DIALOG_GLOBALSEARCH === options.hotkey) {
        const globalScope = resolveGlobalSearchScope(localData);
        hPath = globalScope.hPath;
        idPath = globalScope.idPath;
    }
    const config = {
        removed: localData.removed,
        k: options.key || localData.k,
        r: localData.r,
        hasReplace: options.hotkey === Constants.DIALOG_REPLACE,
        method: localData.method === 4 && !window.siyuan.config.ai.embedding.enabled ? 0 : localData.method,
        hPath,
        idPath,
        group: localData.group,
        sort: localData.sort,
        types: Object.assign({}, localData.types),
        subTypes: Object.assign({}, localData.subTypes),
        replaceTypes: Object.assign({}, localData.replaceTypes),
        page: options.key ? 1 : localData.page
    };
    setSearchConfigTemporaryPath(config, hasScopedPath || options.hotkey === Constants.DIALOG_SEARCH);
    // 搜索中继续执行 ctrl+F/P 不退出 https://github.com/siyuan-note/siyuan/issues/11637
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item !== existingSearchDialog || (isCurrentPathRequest && !isCurrentPathRequest())) {
            return false;
        }
        // 再次打开
        if (item.element.querySelector("#searchList")) {
            const searchElement = item.element.querySelector(".b3-dialog__body");
            const cloneData = JSON.parse(JSON.stringify(item.data)) as Config.IUILayoutTabSearchConfig;
            const selectText = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0).toString() : undefined;
            if (selectText) {
                cloneData.k = selectText;
            }
            if (hasScopedPath) {
                setSearchConfigTemporaryPath(item.data, true);
            } else if (options.hotkey === Constants.DIALOG_GLOBALSEARCH) {
                setSearchConfigTemporaryPath(item.data, false);
            }
            item.element.setAttribute("data-key", options.hotkey);
            if (options.notebookId || options.notebookIds?.length) {
                cloneData.hasReplace = options.hotkey === Constants.DIALOG_REPLACE;
                cloneData.hPath = hPath;
                cloneData.idPath = [...idPath];
                item.data = updateConfig(searchElement, cloneData, item.data, item.editors.edit, {
                    storageConfig: replaceSearchConfigPath(cloneData, localData),
                });
            } else if (options.hotkey === Constants.DIALOG_REPLACE) {
                cloneData.hasReplace = true;
                item.data = updateConfig(searchElement, cloneData, item.data, item.editors.edit, {
                    storageConfig: replaceSearchConfigPath(cloneData, localData),
                });
            } else if (options.hotkey === Constants.DIALOG_GLOBALSEARCH) {
                cloneData.hasReplace = false;
                cloneData.hPath = hPath;
                cloneData.idPath = [...idPath];
                item.data = updateConfig(searchElement, cloneData, item.data, item.editors.edit, {
                    storageConfig: replaceSearchConfigPath(cloneData, localData),
                });
            } else if (options.hotkey === Constants.DIALOG_SEARCH) {
                const toPath = item.editors.edit.protyle.path;
                const toNotebook = item.editors.edit.protyle.notebookId;
                fetchPost("/api/filetree/getHPathsByPaths", {paths: [toPath]}, (response) => {
                    if (version !== openSearchVersion || !item.element.isConnected ||
                        item.element.getAttribute("data-key") !== Constants.DIALOG_SEARCH ||
                        (isCurrentPathRequest && !isCurrentPathRequest())) {
                        return;
                    }
                    if (!Array.isArray(response.data) || typeof response.data[0] !== "string") {
                        return;
                    }
                    const currentData = JSON.parse(JSON.stringify(item.data)) as Config.IUILayoutTabSearchConfig;
                    currentData.hasReplace = false;
                    if (selectText) {
                        currentData.k = selectText;
                    }
                    currentData.idPath = [pathPosix().join(toNotebook, toPath)];
                    currentData.hPath = response.data[0];
                    setSearchConfigTemporaryPath(item.data, true);
                    item.data = updateConfig(searchElement, currentData, item.data, item.editors.edit, {
                        storageConfig: replaceSearchConfigPath(
                            currentData, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]),
                    });
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
            cancelSearchRequest(dialog.element.querySelector(".b3-dialog__body"));
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
