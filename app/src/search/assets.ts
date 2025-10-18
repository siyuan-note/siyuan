import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {escapeAriaLabel} from "../util/escape";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
/// #if !MOBILE
import {genQueryHTML} from "./util";
/// #endif
import {MenuItem} from "../menus/Menu";
import {Dialog} from "../dialog";
import {addClearButton} from "../util/addClearButton";
import {saveAssetKeyList} from "./toggleHistory";

export const openSearchAsset = (element: HTMLElement, isStick: boolean) => {
    /// #if !MOBILE
    window.siyuan.menus.menu.remove();
    element.previousElementSibling.classList.add("fn__none");
    element.classList.remove("fn__none");
    if (element.innerHTML) {
        (element.querySelector("#searchAssetInput") as HTMLInputElement).select();
        return;
    }
    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
    element.parentElement.querySelector(".fn__loading--top").classList.remove("fn__none");
    let enterTip = "";
    /// #if !BROWSER
    enterTip = `<kbd>${window.siyuan.languages.enterKey}/${window.siyuan.languages.doubleClick}</kbd> ${window.siyuan.languages.showInFolder}`;
    /// #endif
    element.innerHTML = `<div class="block__icons">
    <span data-type="assetPrevious" class="block__icon block__icon--show ariaLabel" data-position="9south" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="assetNext" class="block__icon block__icon--show ariaLabel" data-position="9south" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    <span class="fn__space"></span>
    <span id="searchAssetResult" class="ft__selectnone"></span>
    <span class="fn__flex-1${!isStick ? " resize__move" : ""}" style="min-height: 100%"></span>
    <span class="fn__space"></span>
    <span id="assetMore" aria-label="${window.siyuan.languages.more}" class="block__icon block__icon--show ariaLabel" data-position="9south">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span id="searchAssetClose" aria-label="${isStick ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon block__icon--show ariaLabel" data-position="9south">
        <svg><use xlink:href="#iconBack"></use></svg>
    </span>
</div>
<div class="b3-form__icon search__header">
    <div class="fn__flex-1" style="position: relative">
        <span class="search__history-icon ariaLabel" id="assetHistoryBtn" aria-label="${updateHotkeyTip("⌥↓")}">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="searchAssetInput" value="${localSearch.k}" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.keyword}">
    </div>
    <div class="block__icons">
        <span data-type="assetRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon ariaLabel" data-position="9south">
            <svg><use xlink:href="#iconRefresh"></use></svg>
        </span>
        <span class="fn__space"></span>
        ${genQueryHTML(localSearch.method, "assetSyntaxCheck")}
        <span class="fn__space"></span>
        <span id="assetFilter" aria-label="${window.siyuan.languages.type}" class="block__icon ariaLabel" data-position="9south">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </span>
    </div>
</div>
<div class="search__layout${localSearch.layout === 1 ? " search__layout--row" : ""}">
    <div id="searchAssetList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
    <div class="search__drag"></div>
    <div id="searchAssetPreview" class="fn__flex-1 search__preview b3-typography" style="padding: 8px;box-sizing: border-box;"></div>
</div>
<div class="search__tip${isStick ? " fn__none" : ""}">
    <kbd>↑/↓/PageUp/PageDown</kbd> ${window.siyuan.languages.searchTip1}
    ${enterTip}
    <kbd>${window.siyuan.languages.click}</kbd> ${window.siyuan.languages.searchTip3}
    <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
</div>`;
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
        saveAssetKeyList(searchInputElement);
    });
    assetInputEvent(element, localSearch);
    addClearButton({
        right: 8,
        height: searchInputElement.clientHeight,
        inputElement: searchInputElement,
        clearCB() {
            assetInputEvent(element, localSearch);
        }
    });

    const dragElement = element.querySelector(".search__drag");
    dragElement.addEventListener("mousedown", (event: MouseEvent) => {
        const documentSelf = document;
        const previousElement = dragElement.previousElementSibling as HTMLElement;
        const direction = localSearch.layout === 1 ? "lr" : "tb";
        const x = event[direction === "lr" ? "clientX" : "clientY"];
        const previousSize = direction === "lr" ? previousElement.offsetWidth : previousElement.offsetHeight;
        const nextSize = direction === "lr" ? previewElement.offsetWidth : previewElement.offsetHeight;

        previewElement.classList.remove("fn__flex-1");
        previewElement.style[direction === "lr" ? "width" : "height"] = nextSize + "px";
        element.style.userSelect = "none";
        documentSelf.onmousemove = (moveEvent: MouseEvent) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            const previousNowSize = (previousSize + (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
            const nextNowSize = (nextSize - (moveEvent[direction === "lr" ? "clientX" : "clientY"] - x));
            if (previousNowSize < 120 || nextNowSize < 120) {
                return;
            }
            previewElement.style[direction === "lr" ? "width" : "height"] = nextNowSize + "px";
        };

        documentSelf.onmouseup = () => {
            element.style.userSelect = "none";
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET][direction === "lr" ? "col" : "row"] = previewElement[direction === "lr" ? "offsetWidth" : "offsetHeight"] + "px";
            setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
        };
    });
    dragElement.addEventListener("dblclick", () => {
        previewElement.style[localSearch.layout === 1 ? "width" : "height"] = "";
        previewElement.classList.add("fn__flex-1");
        const direction = localSearch.layout === 1 ? "lr" : "tb";
        window.siyuan.storage[Constants.LOCAL_SEARCHASSET][direction === "lr" ? "col" : "row"] = "";
        setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
    });
    /// #endif
};

let inputTimeout: number;
export const assetInputEvent = (element: Element, localSearch?: ISearchAssetOption, page = 1) => {
    const loadingElement = element.parentElement.querySelector(".fn__loading--top");
    loadingElement.classList.remove("fn__none");
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
            loadingElement.classList.add("fn__none");
            const nextElement = element.querySelector('[data-type="assetNext"]');
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
<span class="b3-list-item__meta b3-list-item__meta--ellipsis ariaLabel" aria-label="${escapeAriaLabel(item.path)}">${item.name}</span>
</div>`;
            });
            const previewElement = element.querySelector("#searchAssetPreview");
            if (response.data.assetContents.length > 0) {
                previewElement.classList.remove("fn__none");
                element.querySelector(".search__drag")?.classList.remove("fn__none");
                renderPreview(previewElement, response.data.assetContents[0].id, searchInputElement.value, localSearch.method);
            } else {
                previewElement.classList.add("fn__none");
                element.querySelector(".search__drag")?.classList.add("fn__none");
            }
            element.querySelector("#searchAssetResult").innerHTML = `<span class="fn__flex-center">${page}/${response.data.pageCount || 1}</span><span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.total} ${response.data.matchedAssetCount}</span>`;
            element.querySelector("#searchAssetList").innerHTML = resultHTML || `<div class="search__empty">
    ${window.siyuan.languages.emptyContent}
</div>`;
        });
    }, Constants.TIMEOUT_INPUT);
};

export const renderPreview = (element: Element, id: string, query: string, queryMethod: number) => {
    fetchPost("/api/search/getAssetContent", {id, query, queryMethod}, (response) => {
        element.innerHTML = `<p style="white-space: pre-wrap;">${response.data.assetContent.content}</p>`;
        const matchElement = element.querySelector("mark");
        if (matchElement) {
            matchElement.classList.add("mark--hl");
            const contentRect = element.getBoundingClientRect();
            element.scrollTop = element.scrollTop + matchElement.getBoundingClientRect().top - contentRect.top - contentRect.height / 2;
        }
    });
};

export const renderNextAssetMark = (element: Element) => {
    let matchElement;
    const allMatchElements = Array.from(element.querySelectorAll("mark"));
    allMatchElements.find((item, itemIndex) => {
        if (item.classList.contains("mark--hl")) {
            item.classList.remove("mark--hl");
            matchElement = allMatchElements[itemIndex + 1];
            return;
        }
    });
    if (!matchElement) {
        matchElement = allMatchElements[0];
    }
    if (matchElement) {
        matchElement.classList.add("mark--hl");
        const contentRect = element.getBoundingClientRect();
        element.scrollTop = element.scrollTop + matchElement.getBoundingClientRect().top - contentRect.top - contentRect.height / 2;
    }
};

export const assetMethodMenu = (target: HTMLElement, cb: () => void) => {
    const method = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method;
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_SEARCH_ASSET_METHOD) {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_SEARCH_ASSET_METHOD);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconExact",
        label: window.siyuan.languages.keyword,
        current: method === 0,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 0;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconQuote",
        label: window.siyuan.languages.querySyntax,
        current: method === 1,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 1;
            cb();
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconRegex",
        label: window.siyuan.languages.regex,
        current: method === 3,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method = 3;
            cb();
        }
    }).element);
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = target.getBoundingClientRect();
    window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom, isLeft: true});
    /// #endif
};

const filterTypesHTML = (types: IObject) => {
    let html = "";
    Constants.SIYUAN_ASSETS_SEARCH.sort((a: string, b: string) => {
        return a.localeCompare(b);
    }).forEach((type: string) => {
        html += `<label class="fn__flex b3-label">
        <div class="fn__flex-1 fn__flex-center">
            ${type}
        </div>
        <span class="fn__space"></span>
        <input class="b3-switch fn__flex-center" data-type="${type}" type="checkbox" ${types[type] ? " checked" : ""}>
    </label>`;
    });
    return html;
};

export const assetFilterMenu = (assetsElement: Element) => {
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].types;
    const filterDialog = new Dialog({
        title: window.siyuan.languages.type,
        content: `<div class="b3-dialog__content">${filterTypesHTML(localData)}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
        height: "70vh",
    });
    filterDialog.element.setAttribute("data-key", Constants.DIALOG_SEARCHASSETSTYPE);
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
        window.siyuan.menus.menu.element.getAttribute("data-name") === Constants.MENU_SEARCH_ASSET_MORE) {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_SEARCH_ASSET_MORE);
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHASSET];
    const sortMenu = [{
        iconHTML: "",
        label: window.siyuan.languages.sortByRankAsc,
        current: localData.sort === 1,
        click() {
            localData.sort = 1;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.sortByRankDesc,
        current: localData.sort === 0,
        click() {
            localData.sort = 0;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.modifiedASC,
        current: localData.sort === 3,
        click() {
            localData.sort = 3;
            cb();
        }
    }, {
        iconHTML: "",
        label: window.siyuan.languages.modifiedDESC,
        current: localData.sort === 2,
        click() {
            localData.sort = 2;
            cb();
        }
    }];
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.sort,
        type: "submenu",
        submenu: sortMenu,
    }).element);
    /// #if !MOBILE
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.layout,
        type: "submenu",
        submenu: [{
            iconHTML: "",
            label: window.siyuan.languages.topBottomLayout,
            current: localData.layout === 0,
            click() {
                element.querySelector(".search__layout").classList.remove("search__layout--row");
                const previewElement = element.querySelector("#searchAssetPreview") as HTMLElement;
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
            iconHTML: "",
            label: window.siyuan.languages.leftRightLayout,
            current: localData.layout === 1,
            click() {
                const previewElement = element.querySelector("#searchAssetPreview") as HTMLElement;
                element.querySelector(".search__layout").classList.add("search__layout--row");
                previewElement.style.height = "";
                if (localData.col) {
                    previewElement.style.width = localData.col;
                    previewElement.classList.remove("fn__flex-1");
                } else {
                    previewElement.classList.add("fn__flex-1");
                }
                localData.layout = 1;
                setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
            }
        }]
    }).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.rebuildIndex,
        click() {
            element.parentElement.querySelector(".fn__loading--top").classList.remove("fn__none");
            fetchPost("/api/asset/fullReindexAssetContent", {}, () => {
                assetInputEvent(element, localData);
            });
        },
    }).element);
    /// #if MOBILE
    window.siyuan.menus.menu.fullscreen();
    /// #else
    const rect = target.getBoundingClientRect();
    window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom, isLeft: true});
    /// #endif
};
