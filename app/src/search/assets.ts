import {Constants} from "../constants";
import {fetchPost} from "../util/fetch";

export const openSearchAsset = (element: HTMLElement, isStick: boolean) => {
    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET]
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
    <input id="searchInput" style="padding-right: 60px" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.keyword}">
    <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    <div class="block__icons">
        <span id="searchRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon b3-tooltips b3-tooltips__w">
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
        <span id="searchAsset" aria-label="${isStick ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon b3-tooltips b3-tooltips__w">
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
    <div id="searchList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
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
    if (element.querySelector("#searchList").innerHTML !== "") {
        return
    }

    fetchPost("/api/search/fullTextSearchAssetContent", {
        page: 1,
        query: localSearch.k,
        types: localSearch.types,
        method: localSearch.method,
        orderBy: localSearch.sort
    }, (response) => {
        loadingElement.classList.remove("fn__none")
        console.log(response)
    })
}
