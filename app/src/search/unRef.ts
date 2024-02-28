import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
/// #if !MOBILE
import {getQueryTip} from "./util";
/// #endif
import {MenuItem} from "../menus/Menu";
import {Dialog} from "../dialog";
import {Menu} from "../plugin/Menu";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {addClearButton} from "../util/addClearButton";
import {isPaidUser} from "../util/needSubscribe";
import {showMessage} from "../dialog/message";

export const openSearchUnRef = (element: Element, isStick: boolean) => {
    /// #if !MOBILE
    window.siyuan.menus.menu.remove();
    element.previousElementSibling.previousElementSibling.classList.add("fn__none");
    element.classList.remove("fn__none");
    if (element.innerHTML) {
        return;
    }
    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHUNREF] as ISearchAssetOption;
    const loadingElement = element.parentElement.querySelector(".fn__loading--top");
    loadingElement.classList.remove("fn__none");
    let enterTip = "";
    /// #if !BROWSER
    enterTip = `<kbd>Enter/Double Click</kbd> ${window.siyuan.languages.showInFolder}`;
    /// #endif
    element.innerHTML = `<div class="block__icons">
    <span data-type="unRefPrevious" class="block__icon block__icon--show ariaLabel" data-position="9bottom" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="unRefNext" class="block__icon block__icon--show ariaLabel" data-position="9bottom" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    <span class="fn__space"></span>
    <span id="searchAssetResult" class="ft__selectnone"></span>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <span id="unRefMore" aria-label="${window.siyuan.languages.more}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span id="searchUnRefClose" aria-label="${isStick ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
        <svg><use xlink:href="#iconBack"></use></svg>
    </span>
</div>
<div class="search__layout${localSearch.layout === 1 ? " search__layout--row" : ""}">
    <div id="searchUnRefList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
    <div class="search__drag"></div>
    <div id="searchUnRefPreview" class="fn__flex-1 search__preview b3-typography" style="padding: 8px"></div>
</div>
<div class="search__tip${isStick ? " fn__none" : ""}">
    <kbd>↑/↓/PageUp/PageDown</kbd> ${window.siyuan.languages.searchTip1}
    ${enterTip}
    <kbd>Click</kbd> ${window.siyuan.languages.searchTip3}
    <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
</div>`;
    if (element.querySelector("#searchUnRefList").innerHTML !== "") {
        return;
    }
    const previewElement = element.querySelector("#searchUnRefPreview") as HTMLElement;
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
            window.siyuan.storage[Constants.LOCAL_SEARCHUNREF][direction === "lr" ? "col" : "row"] = nextElement[direction === "lr" ? "clientWidth" : "clientHeight"] + "px";
            setStorageVal(Constants.LOCAL_SEARCHUNREF, window.siyuan.storage[Constants.LOCAL_SEARCHUNREF]);
        };
    });
    /// #endif
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


export const assetMoreMenu = (target: Element, element: Element, cb: () => void) => {
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "searchAssetMore") {
        window.siyuan.menus.menu.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    window.siyuan.menus.menu.element.setAttribute("data-name", "searchAssetMore");
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHUNREF];
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
                setStorageVal(Constants.LOCAL_SEARCHUNREF, window.siyuan.storage[Constants.LOCAL_SEARCHUNREF]);
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
                setStorageVal(Constants.LOCAL_SEARCHUNREF, window.siyuan.storage[Constants.LOCAL_SEARCHUNREF]);
            }
        }]
    }).element);
    /// #endif
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: "",
        label: window.siyuan.languages.rebuildIndex,
        click() {
            if (!isPaidUser()) {
                showMessage(window.siyuan.languages["_kernel"][214]);
                return;
            }
            element.nextElementSibling.classList.remove("fn__none");
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
