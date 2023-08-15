/// #if !BROWSER
import {shell} from "electron";
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {upDownHint} from "../util/upDownHint";
import {escapeHtml} from "../util/escape";
import {setStorageVal} from "../protyle/util/compatibility";
import {getQueryTip} from "./util";
import {MenuItem} from "../menus/Menu";
import {Dialog} from "../dialog";

export const openSearchAsset = (element: Element, isStick: boolean) => {
    window.siyuan.menus.menu.remove();
    element.previousElementSibling.classList.add("fn__none");
    element.classList.remove("fn__none");
    if (element.innerHTML) {
        (element.querySelector("#searchAssetInput") as HTMLInputElement).select();
        return;
    }
    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
    const loadingElement = element.nextElementSibling;
    loadingElement.classList.remove("fn__none");
    let enterTip = "";
    /// #if !BROWSER
    enterTip = `<kbd>Enter/Double Click</kbd> ${window.siyuan.languages.showInFolder}`;
    /// #endif
    element.innerHTML = `<div class="b3-form__icon search__header">
    <span class="fn__a" id="assetHistoryBtn">
        <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
    </span>
    <input id="searchAssetInput" value="${localSearch.k}" style="padding-right: 60px" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.keyword}">
    <div id="searchAssetHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    <div class="block__icons">
        <span data-type="assetRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconRefresh"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="assetSyntaxCheck" aria-label="${getQueryTip(localSearch.method)}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconRegex"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="assetFilter" aria-label="${window.siyuan.languages.type}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="assetMore" aria-label="${window.siyuan.languages.more}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconMore"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchAssetClose" aria-label="${isStick ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconBack"></use></svg>
        </span>
    </div>
</div>
<div class="block__icons">
    <span data-type="assetPrevious" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="assetNext" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    <span class="fn__space"></span>
    <span id="searchAssetResult"></span>
    <span class="fn__space"></span>
    <span class="fn__flex-1"></span>
</div>
<div class="search__layout${localSearch.layout === 1 ? " search__layout--row" : ""}">
    <div id="searchAssetList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
    <div class="search__drag"></div>
    <div id="searchAssetPreview" class="fn__flex-1 search__preview" style="padding: 8px"></div>
</div>
<div class="search__tip${isStick ? "" : " fn__none"}">
    <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
    ${enterTip}
    <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
</div>`;
    const searchPanelElement = element.querySelector("#searchAssetList");
    if (element.querySelector("#searchAssetList").innerHTML !== "") {
        return;
    }
    const previewElement = element.querySelector("#searchAssetPreview") as HTMLElement;
    if (localSearch.layout === 1) {
        if (localSearch.col) {
            previewElement.style.width = localSearch.col;
            previewElement.classList.remove("fn__flex-1");
        }
    } else {
        if (localSearch.row) {
            previewElement.classList.remove("fn__flex-1");
            previewElement.style.height = localSearch.row;
        }
    }

    const searchInputElement = element.querySelector("#searchAssetInput") as HTMLInputElement;
    searchInputElement.select();
    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        assetInputEvent(element, localSearch);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        assetInputEvent(element, localSearch);
    });
    searchInputElement.addEventListener("blur", () => {
        if (!searchInputElement.value) {
            return;
        }
        let list: string[] = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys;
        list.splice(0, 0, searchInputElement.value);
        list = Array.from(new Set(list));
        if (list.length > window.siyuan.config.search.limit) {
            list.splice(window.siyuan.config.search.limit, list.length - window.siyuan.config.search.limit);
        }
        window.siyuan.storage[Constants.LOCAL_SEARCHASSET].k = searchInputElement.value;
        window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys = list;
        setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
    });
    const historyElement = element.querySelector("#searchAssetHistoryList");
    const lineHeight = 28;
    searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
        const isHistory = !historyElement.classList.contains("fn__none");
        if (event.key === "Enter") {
            if (!isHistory) {
                if (currentList) {
                    /// #if !BROWSER
                    shell.showItemInFolder(path.join(window.siyuan.config.system.dataDir, currentList.lastElementChild.getAttribute("aria-label")));
                    /// #endif
                }
            } else {
                searchInputElement.value = historyElement.querySelector(".b3-list-item--focus").textContent.trim();
                assetInputEvent(element, localSearch);
                toggleAssetHistory(historyElement, searchInputElement);
            }
            event.preventDefault();
        }
        if (event.key === "ArrowDown" && event.altKey) {
            toggleAssetHistory(historyElement, searchInputElement);
            return;
        }
        if (isHistory) {
            if (event.key === "Escape") {
                toggleAssetHistory(historyElement, searchInputElement);
            } else {
                upDownHint(historyElement, event);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (!currentList) {
            return;
        }
        if (event.key === "ArrowDown") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.nextElementSibling) {
                searchPanelElement.firstElementChild.classList.add("b3-list-item--focus");
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
                searchPanelElement.lastElementChild.classList.add("b3-list-item--focus");
            } else {
                currentList.previousElementSibling.classList.add("b3-list-item--focus");
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop - lineHeight * 2) {
                searchPanelElement.scrollTop = currentList.offsetTop - lineHeight * 2;
            }
            event.preventDefault();
        }
        renderPreview(previewElement, currentList.dataset.id, searchInputElement.value, localSearch.method);
    });
    assetInputEvent(element, localSearch);

    const dragElement = element.querySelector(".search__drag");
    dragElement.addEventListener("mousedown", (event: MouseEvent) => {
        const documentSelf = document;
        const nextElement = dragElement.nextElementSibling as HTMLElement;
        const previousElement = dragElement.previousElementSibling as HTMLElement;
        const direction = localSearch.layout === 1 ? "lr" : "tb";
        const x = event[direction === "lr" ? "clientX" : "clientY"];
        const previousSize = direction === "lr" ? previousElement.clientWidth : previousElement.clientHeight;
        const nextSize = direction === "lr" ? nextElement.clientWidth : nextElement.clientHeight;

        nextElement.classList.remove("fn__flex-1");
        nextElement.style[direction === "lr" ? "width" : "height"] = nextSize + "px";

        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            const previousNowSize = (previousSize + (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
            const nextNowSize = (nextSize - (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
            if (previousNowSize < 120 || nextNowSize < 120) {
                return;
            }
            nextElement.style[direction === "lr" ? "width" : "height"] = nextNowSize + "px";
        };

        documentSelf.onmouseup = () => {
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET][direction === "lr" ? "col" : "row"] = nextElement[direction === "lr" ? "clientWidth" : "clientHeight"] + "px";
            setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
        };
    });
};

let inputTimeout: number;
export const assetInputEvent = (element: Element, localSearch?: ISearchAssetOption, page = 1,) => {
    element.nextElementSibling.classList.remove("fn__none");
    clearTimeout(inputTimeout);
    inputTimeout = window.setTimeout(() => {
        if (!localSearch) {
            localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
        }
        const previousElement = element.querySelector('[data-type="assetPrevious"]');
        if (page > 1) {
            previousElement.removeAttribute("disabled");
        } else {
            previousElement.setAttribute("disabled", "disabled");
        }
        const searchInputElement = element.querySelector("#searchAssetInput") as HTMLInputElement;
        fetchPost("/api/search/fullTextSearchAssetContent", {
            page,
            query: searchInputElement.value,
            types: localSearch.types,
            method: localSearch.method,
            orderBy: localSearch.sort
        }, (response) => {
            element.nextElementSibling.classList.add("fn__none");
            const nextElement = element.querySelector('[data-type="assetNext"]');
            const previewElement = element.querySelector("#searchAssetPreview");
            if (page < response.data.pageCount) {
                nextElement.removeAttribute("disabled");
            } else {
                nextElement.setAttribute("disabled", "disabled");
            }
            let resultHTML = "";
            response.data.assetContents.forEach((item: {
                content: string
                ext: string
                id: string
                path: string
                name: string
                hSize: string
            }, index: number) => {
                resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-id="${item.id}">
<span class="ft__on-surface">${item.ext}</span>
<span class="fn__space"></span>
<span class="b3-list-item__text">${item.content}</span>
<span class="b3-list-item__meta">${item.hSize}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis b3-tooltips__w b3-tooltips" aria-label="${item.path}">${item.name}</span>
</div>`;
            });
            if (response.data.assetContents.length > 0) {
                previewElement.classList.remove("fn__none");
                element.querySelector(".search__drag").classList.remove("fn__none");
                renderPreview(previewElement, response.data.assetContents[0].id, searchInputElement.value, localSearch.method);
            } else {
                previewElement.classList.add("fn__none");
                element.querySelector(".search__drag").classList.add("fn__none");
            }
            element.querySelector("#searchAssetResult").innerHTML = `${page}/${response.data.pageCount || 1}<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.total} ${response.data.matchedAssetCount}</span>`;
            element.querySelector("#searchAssetList").innerHTML = resultHTML || `<div class="search__empty">
    ${window.siyuan.languages.emptyContent}
</div>`;
        });
    }, Constants.TIMEOUT_INPUT);
};

export const toggleAssetHistory = (historyElement: Element, searchInputElement: HTMLInputElement) => {
    if (historyElement.classList.contains("fn__none")) {
        const keys = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys;
        if (!keys || keys.length === 0) {
            return;
        }
        let html = "";
        keys.forEach((s: string) => {
            if (s !== searchInputElement.value && s) {
                html += `<div class="b3-list-item${html ? "" : " b3-list-item--focus"}">${escapeHtml(s)}</div>`;
            }
        });
        if (html === "") {
            return;
        }
        historyElement.classList.remove("fn__none");
        historyElement.innerHTML = html;
    } else {
        historyElement.classList.add("fn__none");
    }
};

export const renderPreview = (element: Element, id: string, query: string, queryMethod: number) => {
    fetchPost("/api/search/getAssetContent", {id, query, queryMethod}, (response) => {
        element.innerHTML = response.data.assetContent.content;
    });
};

export const assetMethodMenu = (target: HTMLElement, cb: () => void) => {
    const method = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method;
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "searchAssetMethod") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", "searchAssetMethod");
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.keyword,
        current: method === 0,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 0;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.querySyntax,
        current: method === 1,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 1;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.regex,
        current: method === 3,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 3;
            cb();
        }
    }).element);
    const rect = target.getBoundingClientRect();
    window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
};

export const assetFilterMenu = (assetsElement: Element) => {
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].types;
    const filterDialog = new Dialog({
        title: window.siyuan.languages.type,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            .txt
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type=".txt" type="checkbox"${localData[".txt"] ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            .md
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type=".md" type="checkbox"${localData[".md"] ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            .docx
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type=".docx" type="checkbox"${localData[".docx"] ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            .xlsx
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type=".xlsx" type="checkbox"${localData[".xlsx"] ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            .pptx
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type=".pptx" type="checkbox"${localData[".pptx"] ? " checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
        height: "70vh",
    });
    const btnsElement = filterDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        filterDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        filterDialog.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            localData[item.getAttribute("data-type")] = item.checked;
        });
        assetInputEvent(assetsElement);
        setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
        filterDialog.destroy();
    });
};

export const assetMoreMenu = (target: Element, element: Element, cb: () => void) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "searchAssetMore") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", "searchAssetMore");
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHASSET]
    const sortMenu = [{
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankAsc,
        current: localData.sort === 1,
        click() {
            localData.sort = 1;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankDesc,
        current: localData.sort === 0,
        click() {
            localData.sort = 0;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedASC,
        current: localData.sort === 3,
        click() {
            localData.sort = 3;
            cb();
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedDESC,
        current: localData.sort === 2,
        click() {
            localData.sort = 2;
            cb();
        }
    }];
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sort,
        type: "submenu",
        submenu: sortMenu,
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.layout,
        type: "submenu",
        submenu: [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.topBottomLayout,
            current: localData.layout === 0,
            click() {
                element.querySelector(".search__layout").classList.remove("search__layout--row");
                const previewElement = element.querySelector("#searchAssetPreview") as HTMLElement
                previewElement.style.width = "";
                if (localData.row) {
                    previewElement.style.height = localData.row;
                    previewElement.classList.remove("fn__flex-1");
                } else {
                    previewElement.classList.add("fn__flex-1");
                }
                localData.layout = 0;
                setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.leftRightLayout,
            current: localData.layout === 1,
            click() {
                const previewElement = element.querySelector("#searchAssetPreview") as HTMLElement
                element.querySelector(".search__layout").classList.add("search__layout--row");
                previewElement.style.height = "";
                if (localData.col) {
                    previewElement.style.width = localData.col
                    previewElement.classList.remove("fn__flex-1");
                } else {
                    previewElement.classList.add("fn__flex-1");
                }
                localData.layout = 1;
                setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
            }
        }]
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.rebuildIndex,
        click() {
            element.nextElementSibling.classList.remove("fn__none");
            fetchPost("/api/asset/fullReindexAssetContent", {}, () => {
                assetInputEvent(element, localData)
            });
        },
    }).element);
    const rect = target.getBoundingClientRect();
    window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
}
