import * as path from "path";
import {fetchPost, fetchSyncPost} from "./fetch";
import {Dialog} from "../dialog";
import {escapeHtml} from "./escape";
import {isMobile} from "./functions";
import {focusByRange} from "../protyle/util/selection";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {unicode2Emoji} from "../emoji";

export const addBaseURL = () => {
    let baseURLElement = document.getElementById("baseURL");
    if (!baseURLElement) {
        baseURLElement = document.createElement("base");
        baseURLElement.id = "baseURL";
    }
    baseURLElement.setAttribute("href", location.origin);
    document.getElementsByTagName("head")[0].appendChild(baseURLElement);
};

export const getDisplayName = (filePath: string, basename = true, removeSY = false) => {
    let name = filePath;
    if (basename) {
        name = pathPosix().basename(filePath);
    }
    if (removeSY && name.endsWith(".sy")) {
        name = name.substr(0, name.length - 3);
    }
    return name;
};

export const isLocalPath = (link: string) => {
    if (!link) {
        return false;
    }
    return link.startsWith("assets/") || link.startsWith("file://");
};

export const pathPosix = () => {
    if (path.posix) {
        return path.posix;
    }
    return path;
};

const moveToPath = (notebookId: string, path: string, toNotebookId: string, toFolderPath: string, dialog: Dialog) => {
    fetchPost("/api/filetree/moveDoc", {
        fromNotebook: notebookId,
        toNotebook: toNotebookId,
        fromPath: path,
        toPath: toFolderPath,
    });
    dialog.destroy();
};

export const movePathTo = async (notebookId: string, path: string, focus = true) => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#foldList")) {
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return;
    }
    const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
        notebook: notebookId,
        path
    });
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    const dialog = new Dialog({
        title: `${window.siyuan.languages.move} <span class="ft__smaller ft__on-surface">${escapeHtml(pathPosix().join(getNotebookName(notebookId), response.data))}</span>`,
        content: `<div class="b3-form__icon b3-form__space">
    <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
    <input class="b3-text-field fn__block b3-form__icon-input" value="" placeholder="${window.siyuan.languages.search}">
</div>
<ul id="foldList" class="b3-list b3-list--background" style="height: 50vh;overflow: auto;position: relative"></ul>`,
        width: isMobile() ? "80vw" : "50vw",
        destroyCallback() {
            if (range && focus) {
                focusByRange(range);
            }
        }
    });

    const searchPanelElement = dialog.element.querySelector("#foldList");
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.focus();
    const inputEvent = (event?: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        fetchPost("/api/filetree/searchDocs", {
            k: inputElement.value
        }, (data) => {
            let fileHTML = "";
            data.data.forEach((item: { boxIcon: string, box: string, hPath: string, path: string }) => {
                if (item.path === pathPosix().dirname(path) + "/" || item.path === path) {
                    return;
                }
                fileHTML += `<li class="b3-list-item${fileHTML === "" ? " b3-list-item--focus" : ""}" data-path="${item.path}" data-box="${item.box}">
    ${item.boxIcon ? ('<span class="b3-list-item__icon">' + unicode2Emoji(item.boxIcon) + "</span>") : ""}
    <span class="b3-list-item__showall">${escapeHtml(item.hPath)}</span>
</li>`;
            });
            searchPanelElement.innerHTML = fileHTML;
        });
    };
    inputEvent();
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        inputEvent(event);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        inputEvent(event);
    });
    const lineHeight = 28;
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        let currentList: HTMLElement = dialog.element.querySelector(".b3-list-item--focus");
        if (!currentList) {
            return;
        }
        if (event.key === "ArrowDown") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.nextElementSibling) {
                searchPanelElement.children[0].classList.add("b3-list-item--focus");
            } else {
                currentList.nextElementSibling.classList.add("b3-list-item--focus");
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop) {
                searchPanelElement.scrollTop = currentList.offsetTop - searchPanelElement.clientHeight + lineHeight;
            }
            event.preventDefault();
        } else if (event.key === "ArrowUp") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.previousElementSibling) {
                const length = searchPanelElement.children.length;
                searchPanelElement.children[length - 1].classList.add("b3-list-item--focus");
            } else {
                currentList.previousElementSibling.classList.add("b3-list-item--focus");
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop - lineHeight * 2) {
                searchPanelElement.scrollTop = currentList.offsetTop - lineHeight * 2;
            }
            event.preventDefault();
        } else if (event.key === "Enter") {
            moveToPath(notebookId, path, currentList.getAttribute("data-box"), currentList.getAttribute("data-path"), dialog);
            event.preventDefault();
        }
    });
    dialog.element.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const liElement = hasClosestByClassName(target, "b3-list-item");
        if (liElement) {
            moveToPath(notebookId, path, liElement.getAttribute("data-box"), liElement.getAttribute("data-path"), dialog);
        }
    });
};

export const getNotebookName = (id: string) => {
    let rootPath = "";
    window.siyuan.notebooks.find((item) => {
        if (item.id === id) {
            rootPath = item.name;
            return true;
        }
    });
    return rootPath;
};

export const setNotebookName = (id: string, name: string) => {
    window.siyuan.notebooks.find((item) => {
        if (item.id === id) {
            item.name = name;
            return true;
        }
    });
};

export const getOpenNotebookCount = () => {
    let count = 0;
    window.siyuan.notebooks.forEach(item => {
        if (!item.closed) {
            count++;
        }
    });
    return count;
};

export const setNoteBook = (cb?: (notebook: INotebook[]) => void) => {
    fetchPost("/api/notebook/lsNotebooks", {}, (response) => {
        window.siyuan.notebooks = response.data.notebooks;
        if (cb) {
            cb(response.data.notebooks);
        }
    });
};
