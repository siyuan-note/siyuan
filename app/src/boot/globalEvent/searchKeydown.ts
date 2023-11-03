/// #if !BROWSER
import * as path from "path";
/// #endif
import {matchHotKey} from "../../protyle/util/hotKey";
import {fetchPost} from "../../util/fetch";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {newFileByName} from "../../util/newFile";
import {upDownHint} from "../../util/upDownHint";
import {App} from "../../index";
import {Dialog} from "../../dialog";
import {getAllModels} from "../../layout/getAll";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {getArticle, inputEvent, replace, toggleReplaceHistory, toggleSearchHistory} from "../../search/util";
import {showFileInFolder} from "../../util/pathName";
import {assetInputEvent, renderPreview, toggleAssetHistory} from "../../search/assets";
import {initSearchMenu} from "../../menus/search";
import {writeText} from "../../protyle/util/compatibility";

export const searchKeydown = (app: App, event: KeyboardEvent) => {
    if (getSelection().rangeCount === 0) {
        return false;
    }
    const range = getSelection().getRangeAt(0);
    if (hasClosestByClassName(range.startContainer, "protyle", true)) {
        return false;
    }
    let element: HTMLElement;
    let dialog: Dialog;
    let edit;
    let config: ISearchOption;
    window.siyuan.dialogs.find((item) => {
        if (item.element.contains(range.startContainer) && item.element.querySelector("#searchList")) {
            element = item.element.querySelector(".b3-dialog__body");
            dialog = item;
            config = dialog.data;
            edit = dialog.editor;
            return true;
        }
    });
    if (!element) {
        getAllModels().search.find((item) => {
            if (item.element.contains(range.startContainer)) {
                element = item.element;
                edit = item.edit;
                config = item.config;
                return true;
            }
        });
    }
    if (!element) {
        return false;
    }
    const assetsElement = element.querySelector("#searchAssets");
    const isAsset = !assetsElement.classList.contains("fn__none");
    const listElement = isAsset ? assetsElement.querySelector("#searchAssetList") : element.querySelector("#searchList");
    let currentList: HTMLElement = listElement.querySelector(".b3-list-item--focus");
    if (!currentList) {
        return false;
    }
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    if (!isAsset && matchHotKey(window.siyuan.config.keymap.general.newFile.custom, event)) {
        newFileByName(app, searchInputElement.value);
        return true;
    }
    const targetId = (event.target as HTMLElement).id;
    const historyElement = element.querySelector("#searchHistoryList");
    const replaceHistoryElement = element.querySelector("#replaceHistoryList");
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;
    const assetHistoryElement = assetsElement.querySelector("#searchAssetHistoryList");
    const assetInputElement = assetsElement.querySelector("#searchAssetInput") as HTMLInputElement;
    const assetPreviewElement = assetsElement.querySelector("#searchAssetPreview");
    if (event.key === "ArrowDown" && event.altKey) {
        if (isAsset) {
            toggleAssetHistory(assetHistoryElement, assetInputElement);
        } else {
            if (targetId === "replaceInput") {
                toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
            } else {
                toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
            }
        }
        return true;
    }
    const assetLocal = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
    let history;
    if (!historyElement.classList.contains("fn__none")) {
        history = "history";
    } else if (!replaceHistoryElement.classList.contains("fn__none")) {
        history = "replaceHistory";
    } else if (isAsset && !assetHistoryElement.classList.contains("fn__none")) {
        history = "assetHistory";
    }
    if (history) {
        if (event.key === "Escape") {
            if (isAsset) {
                toggleAssetHistory(assetHistoryElement, assetInputElement);
            } else {
                if ((event.target as HTMLElement).id === "replaceInput") {
                    toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
                } else {
                    toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
                }
            }
        } else if (event.key === "Enter") {
            if (history === "replaceHistory") {
                replaceInputElement.value = replaceHistoryElement.querySelector(".b3-list-item--focus").textContent.trim();
                toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
            } else if (history === "assetHistory") {
                assetInputElement.value = assetHistoryElement.querySelector(".b3-list-item--focus").textContent.trim();
                assetInputEvent(assetsElement, assetLocal);
                toggleAssetHistory(assetHistoryElement, assetInputElement);
                renderPreview(assetPreviewElement, currentList.dataset.id, assetInputElement.value, assetLocal.method);
            } else {
                searchInputElement.value = historyElement.querySelector(".b3-list-item--focus").textContent.trim();
                config.page = 1;
                inputEvent(element, config, edit, true);
                toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
            }
        } else {
            if (history === "assetHistory") {
                upDownHint(assetHistoryElement, event);
            } else {
                if (history === "replaceHistory") {
                    upDownHint(replaceHistoryElement, event);
                } else {
                    upDownHint(historyElement, event);
                }
            }
        }
        return true;
    }
    if (currentList.getAttribute("data-type") === "search-new") {
        if (event.key === "Enter") {
            newFileByName(app, searchInputElement.value);
            return true;
        }
        return false;
    }
    if (!isAsset) {
        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                openFileById({
                    app,
                    id,
                    position: "right",
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] :
                        (id === currentList.getAttribute("data-root-id") ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ROOTSCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]),
                    zoomIn: foldResponse.data
                });
                if (dialog) {
                    dialog.destroy({focus: "false"});
                }
            });
            return true;
        }
        const id = currentList.getAttribute("data-node-id");
        if (matchHotKey("⌘/", event)) {
            const currentRect = currentList.getBoundingClientRect();
            initSearchMenu(id).popup({
                x: currentRect.left + 30,
                y: currentRect.bottom
            });
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockRef.custom, event)) {
            fetchPost("/api/block/getRefText", {id}, (response) => {
                writeText(`((${id} '${response.data}'))`);
            });
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyBlockEmbed.custom, event)) {
            writeText(`{{select * from blocks where id='${id}'}}`);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocol.custom, event)) {
            writeText(`siyuan://blocks/${id}`);
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyProtocolInMd.custom, event)) {
            fetchPost("/api/block/getRefText", {id}, (response) => {
                writeText(`[${response.data}](siyuan://blocks/${id})`);
            });
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyHPath.custom, event)) {
            fetchPost("/api/filetree/getHPathByID", {
                id
            }, (response) => {
                writeText(response.data);
            });
            return true;
        }
        if (matchHotKey(window.siyuan.config.keymap.editor.general.copyID.custom, event)) {
            writeText(id);
            return true;
        }
    }

    if (Constants.KEYCODELIST[event.keyCode] === "PageUp") {
        if (isAsset) {
            if (!assetsElement.querySelector('[data-type="assetPrevious"]').getAttribute("disabled")) {
                let currentPage = parseInt(assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/")[0]);
                if (currentPage > 1) {
                    currentPage--;
                    assetInputEvent(assetsElement, assetLocal, currentPage);
                }
            }
        } else {
            if (!element.querySelector('[data-type="previous"]').getAttribute("disabled")) {
                if (config.page > 1) {
                    config.page--;
                    inputEvent(element, config, edit);
                }
            }
        }
        return true;
    }
    if (Constants.KEYCODELIST[event.keyCode] === "PageDown") {
        if (isAsset) {
            if (!assetsElement.querySelector('[data-type="assetNext"]').getAttribute("disabled")) {
                const assetPages = assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/");
                let currentPage = parseInt(assetPages[0]);
                if (currentPage < parseInt(assetPages[1])) {
                    currentPage++;
                    assetInputEvent(assetsElement, assetLocal, currentPage);
                }
            }
        } else {
            const nextElement = element.querySelector('[data-type="next"]');
            if (!nextElement.getAttribute("disabled")) {
                if (config.page < parseInt(nextElement.parentElement.querySelector("#searchResult").getAttribute("data-pagecount"))) {
                    config.page++;
                    inputEvent(element, config, edit);
                }
            }
        }
        return true;
    }
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        return false;
    }
    if (event.key === "Enter") {
        if (!isAsset) {
            if (targetId === "replaceInput") {
                replace(element, config, edit, false);
            } else {
                const id = currentList.getAttribute("data-node-id");
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        app,
                        id,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] :
                            (id === currentList.getAttribute("data-root-id") ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ROOTSCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]),
                        zoomIn: foldResponse.data
                    });
                    if (dialog) {
                        dialog.destroy({focus: "false"});
                    }
                });
            }
        } else {
            /// #if !BROWSER
            showFileInFolder(path.join(window.siyuan.config.system.dataDir, currentList.lastElementChild.getAttribute("aria-label")));
            /// #endif
        }
        return true;
    }
    const lineHeight = 28;
    if (event.key === "ArrowDown") {
        currentList.classList.remove("b3-list-item--focus");
        if (!currentList.nextElementSibling) {
            if (config.group === 1 && !isAsset) {
                if (currentList.parentElement.nextElementSibling) {
                    currentList.parentElement.nextElementSibling.nextElementSibling.firstElementChild.classList.add("b3-list-item--focus");
                } else {
                    listElement.children[1].firstElementChild.classList.add("b3-list-item--focus");
                }
            } else {
                listElement.firstElementChild.classList.add("b3-list-item--focus");
            }
        } else {
            currentList.nextElementSibling.classList.add("b3-list-item--focus");
        }
        currentList = listElement.querySelector(".b3-list-item--focus");
        if (listElement.scrollTop < currentList.offsetTop - listElement.clientHeight + lineHeight ||
            listElement.scrollTop > currentList.offsetTop) {
            listElement.scrollTop = currentList.offsetTop - listElement.clientHeight + lineHeight;
        }
        if (isAsset) {
            renderPreview(assetPreviewElement, currentList.dataset.id, searchInputElement.value, assetLocal.method);
        } else {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                config,
                value: searchInputElement.value,
                edit,
            });
        }
        return true;
    }
    if (event.key === "ArrowUp") {
        currentList.classList.remove("b3-list-item--focus");
        if (!currentList.previousElementSibling) {
            if (config.group === 1 && !isAsset) {
                if (currentList.parentElement.previousElementSibling.previousElementSibling) {
                    currentList.parentElement.previousElementSibling.previousElementSibling.lastElementChild.classList.add("b3-list-item--focus");
                } else {
                    listElement.lastElementChild.lastElementChild.classList.add("b3-list-item--focus");
                }
            } else {
                listElement.lastElementChild.classList.add("b3-list-item--focus");
            }
        } else {
            currentList.previousElementSibling.classList.add("b3-list-item--focus");
        }
        currentList = listElement.querySelector(".b3-list-item--focus");
        if (listElement.scrollTop < currentList.offsetTop - listElement.clientHeight + lineHeight ||
            listElement.scrollTop > currentList.offsetTop - lineHeight * 2) {
            listElement.scrollTop = currentList.offsetTop - lineHeight * 2;
        }
        if (isAsset) {
            renderPreview(assetPreviewElement, currentList.dataset.id, searchInputElement.value, assetLocal.method);
        } else {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                config,
                value: searchInputElement.value,
                edit,
            });
        }
        return true;
    }
    return false;
};
