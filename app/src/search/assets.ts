import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";
import {upDownHint} from "../util/upDownHint";
import {escapeHtml} from "../util/escape";

export const openSearchAsset = (element: Element, isStick: boolean) => {
    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption
    let methodText = window.siyuan.languages.keyword;
    if (localSearch.method === 1) {
        methodText = window.siyuan.languages.querySyntax;
    } else if (localSearch.method === 2) {
        methodText = "SQL";
    } else if (localSearch.method === 3) {
        methodText = window.siyuan.languages.regex;
    }
    const loadingElement = element.nextElementSibling;
    loadingElement.classList.remove("fn__none");
    element.innerHTML = `<div class="b3-form__icon search__header">
    <span class="fn__a" id="searchHistoryBtn">
        <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
    </span>
    <input id="searchAssetInput" value="${localSearch.k}" style="padding-right: 60px" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.keyword}">
    <div id="searchAssetHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    <div class="block__icons">
        <span data-type="reindexAssets" aria-label="${window.siyuan.languages.refresh}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconRefresh"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchSyntaxCheck" aria-label="${window.siyuan.languages.searchMethod} ${methodText}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconRegex"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchFilter" aria-label="${window.siyuan.languages.type}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchMore" aria-label="${window.siyuan.languages.more}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconMore"></use></svg>
        </span>
        <span class="${isStick ? "" : "fn__none "}fn__space"></span>
        <span id="searchOpen" aria-label="${window.siyuan.languages.openInNewTab}" class="${isStick ? "" : "fn__none "}block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconLayoutRight"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchAssetClose" aria-label="${isStick ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconBack"></use></svg>
        </span>
    </div>
</div>
<div class="block__icons">
    <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    <span class="fn__space"></span>
    <span id="searchResult"></span>
    <span class="fn__space"></span>
    <span class="fn__flex-1"></span>
</div>
<div class="search__layout${localSearch.layout === 1 ? " search__layout--row" : ""}">
    <div id="searchAssetList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
    <div class="search__drag"></div>
    <div id="searchPreview" class="fn__flex-1 search__preview"></div>
</div>
<div class="search__tip${isStick ? "" : " fn__none"}">
    <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
    <kbd>Enter/Double Click</kbd> ${window.siyuan.languages.searchTip2}
    <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
</div>`
    element.previousElementSibling.classList.add("fn__none");
    element.classList.remove("fn__none")
    const searchPanelElement = element.querySelector("#searchAssetList");
    if (element.querySelector("#searchAssetList").innerHTML !== "") {
        return
    }
    const searchInputElement = element.querySelector("#searchAssetInput") as HTMLInputElement
    searchInputElement.select();
    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        inputEvent(localSearch, element, 1);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        inputEvent(localSearch, element, 1);
    });
    searchInputElement.addEventListener("blur", () => {
        // saveKeyList("keys", searchInputElement.value);
    });
    const historyElement = element.querySelector("#searchAssetHistoryList")
    const lineHeight = 30;
    searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
        if (!currentList || event.isComposing) {
            return;
        }
        const isHistory = !historyElement.classList.contains("fn__none");
        if (event.key === "Enter") {
            if (!isHistory) {
                // TODO open folder
            } else {
                searchInputElement.value = historyElement.querySelector(".b3-list-item--focus").textContent.trim();
                inputEvent(localSearch, element, 1);
                toggleSearchHistory(historyElement, searchInputElement);
            }
            event.preventDefault();
        }
        if (event.key === "ArrowDown" && event.altKey) {
            toggleSearchHistory(historyElement, searchInputElement);
            return;
        }
        if (isHistory) {
            if (event.key === "Escape") {
                toggleSearchHistory(historyElement, searchInputElement);
            } else {
                upDownHint(historyElement, event);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (!isHistory) {
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
    });
    inputEvent(localSearch, element);
}


const inputEvent = (localSearch: ISearchAssetOption, element: Element, page = 1) => {
    const searchInputElement = element.querySelector("#searchAssetInput") as HTMLInputElement
    fetchPost("/api/search/fullTextSearchAssetContent", {
        page,
        query: searchInputElement.value,
        types: localSearch.types,
        method: localSearch.method,
        orderBy: localSearch.sort
    }, (response) => {
        element.nextElementSibling.classList.add("fn__none")
        console.log(response)
    })
}


export const reIndexAssets = (loadingElement: HTMLElement) => {
    loadingElement.classList.remove("fn__none")
    fetchPost("/api/asset/fullReindexAssetContent", {}, (response) => {
        loadingElement.classList.add("fn__none")
    })
}

const toggleSearchHistory = (historyElement: Element, searchInputElement: HTMLInputElement) => {
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
