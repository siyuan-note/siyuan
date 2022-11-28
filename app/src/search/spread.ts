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
    const localData = JSON.parse(localStorage.getItem(Constants.LOCAL_SEARCHEDATA) || "{}");
    if (!localData.types) {
        localData.types = {
            document: window.siyuan.config.search.document,
            heading: window.siyuan.config.search.heading,
            list: window.siyuan.config.search.list,
            listItem: window.siyuan.config.search.listItem,
            codeBlock: window.siyuan.config.search.codeBlock,
            htmlBlock: window.siyuan.config.search.htmlBlock,
            mathBlock: window.siyuan.config.search.mathBlock,
            table: window.siyuan.config.search.table,
            blockquote: window.siyuan.config.search.blockquote,
            superBlock: window.siyuan.config.search.superBlock,
            paragraph: window.siyuan.config.search.paragraph,
        };
    }
    if (notebookId) {
        localData.hPath = escapeHtml(getNotebookName(notebookId));
        localData.idPath = notebookId;
        if (searchPath && searchPath !== "/") {
            const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
                notebook: notebookId,
                path: searchPath.endsWith(".sy") ? searchPath : searchPath + ".sy"
            });
            localData.hPath = pathPosix().join(localData.hPath, escapeHtml(response.data));
            localData.idPath = pathPosix().join(localData.idPath, searchPath);
        }
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
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
        r: localData.r || "",
        hasReplace: hotkey === window.siyuan.config.keymap.general.replace.custom,
        method: localData.method || 0,
        hPath: localData.hPath || "",
        idPath: localData.idPath || "",
        list: localData.list || [],
        replaceList: localData.replaceList || [],
        group: localData.group || 0,
        types: localData.types
    }, dialog.element.querySelector(".b3-dialog__container").lastElementChild, () => {
        dialog.destroy();
    });
    dialog.element.firstElementChild.setAttribute("style", "z-index:199"); // https://github.com/siyuan-note/siyuan/issues/3515
};
