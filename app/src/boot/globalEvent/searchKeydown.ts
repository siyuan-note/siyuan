/// #if !BROWSER
import * as path from "path";
/// #endif
import {matchHotKey} from "../../protyle/util/hotKey";
import {fetchPost} from "../../util/fetch";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {newFileByName} from "../../util/newFile";
import {App} from "../../index";
import {Dialog} from "../../dialog";
import {getAllModels} from "../../layout/getAll";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {getArticle, inputEvent, replace, toggleReplaceHistory, toggleSearchHistory} from "../../search/util";
import {showFileInFolder} from "../../util/pathName";
import {assetInputEvent, renderPreview, toggleAssetHistory} from "../../search/assets";
import {initSearchMenu} from "../../menus/search";
import {writeText} from "../../protyle/util/compatibility";
import {checkFold} from "../../util/noRelyPCFunction";
import {getUnRefList} from "../../search/unRef";

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
    let unRefEdit;
    let config: Config.IUILayoutTabSearchConfig;
    window.siyuan.dialogs.find((item) => {
        if (item.element.contains(range.startContainer) && item.element.querySelector("#searchList")) {
            element = item.element.querySelector(".b3-dialog__body");
            dialog = item;
            config = dialog.data;
            edit = dialog.editors.edit;
            unRefEdit = dialog.editors.unRefEdit;
            return true;
        }
    });
    if (!element) {
        getAllModels().search.find((item) => {
            if (item.element.contains(range.startContainer)) {
                element = item.element;
                edit = item.editors.edit;
                config = item.config;
                unRefEdit = item.editors.unRefEdit;
                return true;
            }
        });
    }
    if (!element) {
        return false;
    }
    const assetsElement = element.querySelector("#searchAssets");
    const unRefElement = element.querySelector("#searchUnRefPanel");
    const searchType = assetsElement.classList.contains("fn__none") ? (unRefElement.classList.contains("fn__none") ? "doc" : "unRef") : "asset";
    const listElement = searchType === "asset" ? assetsElement.querySelector("#searchAssetList") : (searchType === "doc" ? element.querySelector("#searchList") : unRefElement.querySelector("#searchUnRefList"));
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    if (searchType === "doc" && matchHotKey(window.siyuan.config.keymap.general.newFile.custom, event)) {
        if (config.method === 0) {
            newFileByName(app, searchInputElement.value);
        }
        return true;
    }
    const targetId = (event.target as HTMLElement).id;
    if (event.key === "ArrowDown" && event.altKey) {
        if (searchType === "asset") {
            toggleAssetHistory(assetsElement);
        } else if (searchType === "doc") {
            if (targetId === "replaceInput") {
                toggleReplaceHistory(element);
            } else {
                toggleSearchHistory(element, config, edit);
            }
        }
        return true;
    }
    const assetLocal = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        // 不能返回 true，否则历史菜单无法使用快捷键
        return false;
    }
    let currentList: HTMLElement = listElement.querySelector(".b3-list-item--focus");
    if (!currentList) {
        return false;
    }
    if (currentList.getAttribute("data-type") === "search-new") {
        if (event.key === "Enter" && config.method === 0) {
            newFileByName(app, searchInputElement.value);
            return true;
        }
        return false;
    }
    if (searchType !== "asset") {
        if (matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
            const id = currentList.getAttribute("data-node-id");
            checkFold(id, (zoomIn, action) => {
                openFileById({
                    app,
                    id,
                    position: "right",
                    action,
                    zoomIn
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
        if (searchType === "asset") {
            if (!assetsElement.querySelector('[data-type="assetPrevious"]').getAttribute("disabled")) {
                let currentPage = parseInt(assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/")[0]);
                if (currentPage > 1) {
                    currentPage--;
                    assetInputEvent(assetsElement, assetLocal, currentPage);
                }
            }
        } else if (searchType === "doc") {
            if (!element.querySelector('[data-type="previous"]').getAttribute("disabled")) {
                if (config.page > 1) {
                    config.page--;
                    inputEvent(element, config, edit);
                }
            }
        } else if (searchType === "unRef") {
            if (!element.querySelector('[data-type="unRefPrevious"]').getAttribute("disabled")) {
                let currentPage = parseInt(unRefElement.querySelector("#searchUnRefResult").textContent);
                if (currentPage > 1) {
                    currentPage--;
                    getUnRefList(unRefElement, unRefEdit, currentPage);
                }
            }
        }
        return true;
    }
    if (Constants.KEYCODELIST[event.keyCode] === "PageDown") {
        if (searchType === "asset") {
            if (!assetsElement.querySelector('[data-type="assetNext"]').getAttribute("disabled")) {
                const assetPages = assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/");
                let currentPage = parseInt(assetPages[0]);
                if (currentPage < parseInt(assetPages[1])) {
                    currentPage++;
                    assetInputEvent(assetsElement, assetLocal, currentPage);
                }
            }
        } else if (searchType === "doc") {
            const nextElement = element.querySelector('[data-type="next"]');
            if (!nextElement.getAttribute("disabled")) {
                if (config.page < parseInt(nextElement.parentElement.querySelector("#searchResult").getAttribute("data-pagecount"))) {
                    config.page++;
                    inputEvent(element, config, edit);
                }
            }
        } else if (searchType === "unRef") {
            if (!element.querySelector('[data-type="unRefNext"]').getAttribute("disabled")) {
                let currentPage = parseInt(unRefElement.querySelector("#searchUnRefResult").textContent);
                if (currentPage < parseInt(unRefElement.querySelector("#searchUnRefResult").textContent.split("/")[1])) {
                    currentPage++;
                    getUnRefList(unRefElement, unRefEdit, currentPage);
                }
            }
        }
        return true;
    }
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        return false;
    }
    if (event.key === "Enter") {
        if (searchType !== "asset") {
            if (targetId === "replaceInput") {
                replace(element, config, edit, false);
            } else {
                const id = currentList.getAttribute("data-node-id");
                checkFold(id, (zoomIn, action) => {
                    openFileById({
                        app,
                        id,
                        action,
                        zoomIn
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
    const assetPreviewElement = assetsElement.querySelector("#searchAssetPreview");
    if (event.key === "ArrowDown") {
        currentList.classList.remove("b3-list-item--focus");
        if (!currentList.nextElementSibling) {
            if (config.group === 1 && searchType === "doc") {
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
        if (searchType === "asset") {
            renderPreview(assetPreviewElement, currentList.dataset.id, searchInputElement.value, assetLocal.method);
        } else if (searchType === "doc") {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                config,
                value: searchInputElement.value,
                edit,
            });
        } else {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                edit: unRefEdit,
            });
        }
        return true;
    }
    if (event.key === "ArrowUp") {
        currentList.classList.remove("b3-list-item--focus");
        if (!currentList.previousElementSibling) {
            if (config.group === 1 && searchType === "doc") {
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
        if (searchType === "asset") {
            renderPreview(assetPreviewElement, currentList.dataset.id, searchInputElement.value, assetLocal.method);
        } else if (searchType === "doc") {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                config,
                value: searchInputElement.value,
                edit,
            });
        } else if (searchType === "unRef") {
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                edit: unRefEdit,
            });
        }
        return true;
    }
    return false;
};
