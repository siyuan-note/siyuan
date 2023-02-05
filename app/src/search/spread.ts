import {escapeHtml} from "../util/escape";
import {getNotebookName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import {Dialog} from "../dialog";
import {fetchSyncPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {genSearch} from "./util";

export const openSearch = async (hotkey: string, key?: string, notebookId?: string, searchPath?: string) => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#searchList")) {
            const lastKey = item.element.getAttribute("data-key");
            const replaceHeaderElement = item.element.querySelectorAll(".search__header")[1];
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.replace.custom && replaceHeaderElement.classList.contains("fn__none")) {
                replaceHeaderElement.classList.remove("fn__none");
                item.element.setAttribute("data-key", hotkey);
                return true;
            }
            const searchPathElement = item.element.querySelector("#searchPathInput");
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.globalSearch.custom) {
                if (searchPathElement.textContent !== "") {
                    item.destroy();
                    return false;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", hotkey);
                    return true;
                }
            }
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.search.custom) {
                if (searchPathElement.textContent === "") {
                    item.destroy();
                    return false;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", hotkey);
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
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHEDATA];
    let hPath = "";
    let idPath: string[] = [];
    if (notebookId) {
        hPath = escapeHtml(getNotebookName(notebookId));
        idPath.push(notebookId);
        if (searchPath && searchPath !== "/") {
            const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                notebook: notebookId,
                path: searchPath.endsWith(".sy") ? searchPath : searchPath + ".sy"
            });
            hPath = pathPosix().join(hPath, escapeHtml(response.data));
            idPath[0] = pathPosix().join(idPath[0], searchPath);
        }
    } else if (window.siyuan.config.keymap.general.globalSearch.custom === hotkey) {
        hPath = localData.hPath;
        idPath = localData.idPath;
        // 历史原因，2.5.2 之前为 string https://github.com/siyuan-note/siyuan/issues/6902
        if (typeof idPath === "string") {
            idPath = [idPath];
        }
    }

    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    const dialog = new Dialog({
        content: "",
        width: "80vw",
        height: "80vh",
        destroyCallback: () => {
            if (range) {
                focusByRange(range);
            }
            if (edit) {
                edit.destroy();
            }
        }
    });
    dialog.element.setAttribute("data-key", hotkey);
    const edit = genSearch({
        k: key || localData.k,
        r: localData.r,
        hasReplace: hotkey === window.siyuan.config.keymap.general.replace.custom,
        method: localData.method,
        hPath,
        idPath,
        group: localData.group,
        sort: localData.sort,
        types: localData.types
    }, dialog.element.querySelector(".b3-dialog__container").lastElementChild, () => {
        dialog.destroy();
    });
    // 搜索面板层级需高于 201（.protyle-hint） 且小于205（.block__popover）
    dialog.element.firstElementChild.setAttribute("style", "z-index:202"); // https://github.com/siyuan-note/siyuan/issues/3515
};
