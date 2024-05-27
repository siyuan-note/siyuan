import {getNotebookName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {fetchSyncPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {genSearch} from "./util";
import {App} from "../index";

export const openSearch = async (options: {
    app: App,
    hotkey: string,
    key?: string,
    notebookId?: string,
    searchPath?: string
}) => {
    // 全局搜索中使用 ctrl+F 需继续执行 https://ld246.com/article/1716632837934
    let globalToPath = false;
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#searchList")) {
            const lastKey = item.element.getAttribute("data-key");
            if (lastKey === Constants.DIALOG_GLOBALSEARCH && options.hotkey === Constants.DIALOG_SEARCH) {
                globalToPath = true;
            }
            const replaceHeaderElement = item.element.querySelectorAll(".search__header")[1];
            if (lastKey !== options.hotkey && options.hotkey === Constants.DIALOG_REPLACE && replaceHeaderElement.classList.contains("fn__none")) {
                replaceHeaderElement.classList.remove("fn__none");
                item.element.setAttribute("data-key", options.hotkey);
                return true;
            }
            const searchPathElement = item.element.querySelector("#searchPathInput");
            if (lastKey !== options.hotkey && options.hotkey === Constants.DIALOG_GLOBALSEARCH) {
                if (searchPathElement.textContent !== "") {
                    item.destroy();
                    return false;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", options.hotkey);
                    return true;
                }
            }
            if (lastKey !== options.hotkey && options.hotkey === Constants.DIALOG_SEARCH) {
                if (searchPathElement.textContent === "") {
                    item.destroy();
                    return false;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", options.hotkey);
                    return true;
                }
            }
            // 切换关闭
            item.destroy();
            return true;
        }
    });
    if (exitDialog && !globalToPath) {
        return;
    }
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
    dialog.editors = genSearch(options.app, config, dialog.element.querySelector(".b3-dialog__body"), () => {
        dialog.destroy({focus: "false"});
    });
    dialog.data = config;
};
