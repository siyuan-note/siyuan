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
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#searchList")) {
            const lastKey = item.element.getAttribute("data-key");
            const replaceHeaderElement = item.element.querySelectorAll(".search__header")[1];
            if (lastKey !== options.hotkey && options.hotkey === window.siyuan.config.keymap.general.replace.custom && replaceHeaderElement.classList.contains("fn__none")) {
                replaceHeaderElement.classList.remove("fn__none");
                item.element.setAttribute("data-key", options.hotkey);
                return true;
            }
            const searchPathElement = item.element.querySelector("#searchPathInput");
            if (lastKey !== options.hotkey && options.hotkey === window.siyuan.config.keymap.general.globalSearch.custom) {
                if (searchPathElement.textContent !== "") {
                    item.destroy();
                    return false;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", options.hotkey);
                    return true;
                }
            }
            if (lastKey !== options.hotkey && options.hotkey === window.siyuan.config.keymap.general.search.custom) {
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
    if (exitDialog) {
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
    } else if (window.siyuan.config.keymap.general.globalSearch.custom === options.hotkey) {
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
        content: "",
        width: "80vw",
        height: "90vh",
        destroyCallback(options: IObject) {
            if (range && !options) {
                focusByRange(range);
            }
            if (edit) {
                edit.destroy();
            }
        }
    });
    dialog.element.setAttribute("data-key", options.hotkey);
    const edit = genSearch(options.app, {
        removed: localData.removed,
        k: options.key || localData.k,
        r: localData.r,
        hasReplace: options.hotkey === window.siyuan.config.keymap.general.replace.custom,
        method: localData.method,
        hPath,
        idPath,
        group: localData.group,
        sort: localData.sort,
        types: Object.assign({}, localData.types),
        page: options.key ? 1 : localData.page
    }, dialog.element.querySelector(".b3-dialog__body"), () => {
        dialog.destroy({focus: "false"});
    });
};
