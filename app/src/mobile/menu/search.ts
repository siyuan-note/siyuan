import {closePanel} from "../util/closePanel";
import {openMobileFileById} from "../editor";
import {Constants} from "../../constants";
import {fetchPost} from "../../util/fetch";
import {getIconByType} from "../../editor/getIcon";
import {preventScroll} from "../../protyle/scroll/preventScroll";
import {openModel} from "./model";
import {getNotebookName, movePathTo, pathPosix} from "../../util/pathName";
import {filterMenu, initCriteriaMenu, moreMenu, queryMenu} from "../../search/menu";
import {setStorageVal} from "../../protyle/util/compatibility";
import {escapeHtml} from "../../util/escape";

const updateConfig = (element: Element, newConfig: ISearchOption, config: ISearchOption) => {
    newConfig.hPath = config.hPath;
    newConfig.idPath = config.idPath.join(",").split(",");
    if (config.hasReplace !== newConfig.hasReplace) {
        if (newConfig.hasReplace) {
            element.querySelector('[data-type="toggle-replace"]').classList.add("toolbar__icon--active");
            element.querySelector(".toolbar").classList.remove("fn__none");
        } else {
            element.querySelector('[data-type="toggle-replace"]').classList.remove("toolbar__icon--active");
            element.querySelector(".toolbar").classList.add("fn__none");
        }
    }
    const searchPathElement = element.querySelector("#searchPath");
    if (newConfig.hPath) {
        searchPathElement.classList.remove("fn__none")
        searchPathElement.innerHTML = `<div class="b3-chip b3-chip--middle">${escapeHtml(newConfig.hPath)}<svg data-type="remove-path" class="b3-chip__close"><use xlink:href="#iconCloseRound"></use></svg></div>`;
    } else {
        searchPathElement.classList.add("fn__none")
    }
    if (config.group !== newConfig.group) {
        if (newConfig.group === 0) {
            element.querySelector('[data-type="expand"]').classList.add("fn__none");
            element.querySelector('[data-type="contract"]').classList.add("fn__none");
        } else {
            element.querySelector('[data-type="expand"]').classList.remove("fn__none");
            element.querySelector('[data-type="contract"]').classList.remove("fn__none");
        }
    }
    let includeChild = true;
    let enableIncludeChild = false;
    newConfig.idPath.forEach(newConfig => {
        if (newConfig.endsWith(".sy")) {
            includeChild = false;
        }
        if (newConfig.split("/").length > 1) {
            enableIncludeChild = true;
        }
    });
    const searchIncludeElement = element.querySelector('[data-type="include"]');
    if (includeChild) {
        searchIncludeElement.classList.add("toolbar__icon--active");
    } else {
        searchIncludeElement.classList.remove("toolbar__icon--active");
    }
    if (enableIncludeChild) {
        searchIncludeElement.removeAttribute("disabled");
    } else {
        searchIncludeElement.setAttribute("disabled", "disabled");
    }
    (document.querySelector("#toolbarSearch") as HTMLInputElement).value = newConfig.k;
    (element.querySelector("#toolbarReplace") as HTMLInputElement).value = newConfig.r;
    Object.assign(config, newConfig);
    window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
    setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
    updateSearchResult(config);
    window.siyuan.menus.menu.remove();
};

const onRecentBlocks = (data: IBlock[], matchedRootCount?: number, matchedBlockCount?: number) => {
    let resultHTML = "";
    if (matchedBlockCount) {
        resultHTML = '<div class="b3-list-item ft__smaller ft__on-surface">' + window.siyuan.languages.findInDoc.replace("${x}", matchedRootCount).replace("${y}", matchedBlockCount) + "</div>";
    }
    data.forEach((item: IBlock) => {
        resultHTML += `<div class="b3-list-item b3-list-item--two" data-url="${item.box}" data-path="${item.path}" data-id="${item.id}">
<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta">${Lute.EscapeHTMLStr(item.hPath)}</div>
</div>`;
    });
    document.querySelector("#searchList").innerHTML = resultHTML;
};

let toolbarSearchTimeout = 0;
export const updateSearchResult = (config: ISearchOption) => {
    clearTimeout(toolbarSearchTimeout);
    toolbarSearchTimeout = window.setTimeout(() => {
        const inputElement = document.getElementById("toolbarSearch") as HTMLInputElement;
        if (inputElement.value === "") {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onRecentBlocks(response.data);
            });
        } else {
            fetchPost("/api/search/fullTextSearchBlock", {query: inputElement.value,}, (response) => {
                onRecentBlocks(response.data.blocks, response.data.matchedRootCount, response.data.matchedBlockCount);
            });
        }
    }, Constants.TIMEOUT_SEARCH);
    return toolbarSearchTimeout
};

const initSearchEvent = (element: Element, config: ISearchOption) => {
    const searchInputElement = document.getElementById("toolbarSearch") as HTMLInputElement;
    searchInputElement.value = config.k || "";
    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        updateSearchResult(config);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        updateSearchResult(config);
    });
    const replaceInputElement = element.querySelector(".toolbar .b3-text-field") as HTMLInputElement
    replaceInputElement.value = config.r || ""

    const criteriaData: ISearchOption[] = [];
    initCriteriaMenu(element.querySelector("#criteria"), criteriaData);

    element.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        while (target && !target.isSameNode(element)) {
            const type = target.getAttribute("data-type");
            if (type === "set-criteria") {
                config.removed = false;
                criteriaData.find(item => {
                    if (item.name === target.innerText.trim()) {
                        updateConfig(element, item, config);
                        return true;
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "remove-criteria") {
                const name = target.parentElement.innerText.trim();
                fetchPost("/api/storage/removeCriterion", {name});
                criteriaData.find((item, index) => {
                    if (item.name === name) {
                        criteriaData.splice(index, 1);
                        return true;
                    }
                });
                if (target.parentElement.parentElement.childElementCount === 1) {
                    target.parentElement.parentElement.classList.add("fn__none");
                    target.parentElement.remove();
                } else {
                    target.parentElement.remove();
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "remove-path") {
                config.idPath = [];
                config.hPath = "";
                element.querySelector("#searchPath").classList.add("fn__none")
                toolbarSearchTimeout = updateSearchResult(config);
                const includeElement = element.querySelector('[data-type="include"]');
                includeElement.classList.remove("toolbar__icon--active");
                includeElement.setAttribute("disabled", "disabled");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchExpand") {
                // Array.from(searchPanelElement.children).forEach(item => {
                //     if (item.classList.contains("b3-list-item")) {
                //         item.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                //         item.nextElementSibling.classList.remove("fn__none");
                //     }
                // });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchCollapse") {
                // Array.from(searchPanelElement.children).forEach(item => {
                //     if (item.classList.contains("b3-list-item")) {
                //         item.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
                //         item.nextElementSibling.classList.add("fn__none");
                //     }
                // });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "path") {
                movePathTo((toPath, toNotebook) => {
                    fetchPost("/api/filetree/getHPathsByPaths", {paths: toPath}, (response) => {
                        config.idPath = [];
                        const hPathList: string[] = [];
                        let enableIncludeChild = false;
                        toPath.forEach((item, index) => {
                            if (item === "/") {
                                config.idPath.push(toNotebook[index]);
                                hPathList.push(getNotebookName(toNotebook[index]));
                            } else {
                                enableIncludeChild = true;
                                config.idPath.push(pathPosix().join(toNotebook[index], item.replace(".sy", "")));
                            }
                        });
                        if (response.data) {
                            hPathList.push(...response.data);
                        }
                        config.hPath = hPathList.join(" ");
                        const searchPathElement = element.querySelector("#searchPath")
                        searchPathElement.classList.remove("fn__none");
                        element.querySelector("#searchPath").innerHTML = `<div class="b3-chip b3-chip--middle">${escapeHtml(config.hPath)}<svg data-type="remove-path" class="b3-chip__close"><use xlink:href="#iconCloseRound"></use></svg></div>`;
                        const includeElement = element.querySelector('[data-type="include"]');
                        includeElement.classList.add("toolbar__icon--active");
                        if (enableIncludeChild) {
                            includeElement.removeAttribute("disabled");
                        } else {
                            includeElement.setAttribute("disabled", "disabled");
                        }
                        toolbarSearchTimeout = updateSearchResult(config);
                    });
                }, [], undefined, window.siyuan.languages.specifyPath);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchInclude") {
                target.classList.toggle("b3-button--cancel");
                if (target.classList.contains("b3-button--cancel")) {
                    config.idPath.forEach((item, index) => {
                        if (!item.endsWith(".sy") && item.split("/").length > 1) {
                            config.idPath[index] = item + ".sy";
                        }
                    });
                } else {
                    config.idPath.forEach((item, index) => {
                        if (item.endsWith(".sy")) {
                            config.idPath[index] = item.replace(".sy", "");
                        }
                    });
                }
                // inputTimeout = inputEvent(element, config, inputTimeout, edit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "toggle-replace") {
                config.hasReplace = !config.hasReplace;
                replaceInputElement.parentElement.classList.toggle("fn__none");
                target.classList.toggle("toolbar__icon--active");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "more") {
                moreMenu(config, criteriaData, element, () => {
                    updateSearchResult(config);
                }, () => {
                    updateConfig(element, {
                        removed: true,
                        sort: 0,
                        group: 0,
                        hasReplace: false,
                        method: 0,
                        hPath: "",
                        idPath: [],
                        k: "",
                        r: "",
                        types: {
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
                            embedBlock: window.siyuan.config.search.embedBlock,
                        }
                    }, config);
                })
                window.siyuan.menus.menu.element.style.zIndex = "220";
                window.siyuan.menus.menu.fullscreen();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "filter") {
                filterMenu(config, () => {
                    updateSearchResult(config)
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "query") {
                queryMenu(config, () => {
                    updateSearchResult(config)
                });
                window.siyuan.menus.menu.element.style.zIndex = "220";
                window.siyuan.menus.menu.fullscreen();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "replaceAllBtn") {
                // replace(element, config, edit, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "replaceBtn") {
                // replace(element, config, edit, false);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item__toggle")) {
                target.parentElement.nextElementSibling.classList.toggle("fn__none");
                target.firstElementChild.classList.toggle("b3-list-item__arrow--open");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-list-item")) {
                if (target.parentElement.id === "searchHistoryList") {
                    searchInputElement.value = target.textContent;
                    // inputTimeout = inputEvent(element, config, inputTimeout, edit);
                } else if (target.parentElement.id === "replaceHistoryList") {
                    replaceInputElement.value = target.textContent;
                } else if (target.getAttribute("data-type") === "search-new") {
                    // newEmptyFileByInput(searchInputElement.value);
                } else if (target.getAttribute("data-type") === "search-item") {
                    const id = target.getAttribute("data-id");
                    if (window.siyuan.mobile.editor.protyle) {
                        preventScroll(window.siyuan.mobile.editor.protyle);
                    }
                    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                        openMobileFileById(id, foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                    });
                    closePanel();
                } else if (target.querySelector(".b3-list-item__toggle")) {
                    target.nextElementSibling.classList.toggle("fn__none");
                    target.firstElementChild.firstElementChild.classList.toggle("b3-list-item__arrow--open");
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    }, false);
};

export const popSearch = (config = window.siyuan.storage[Constants.LOCAL_SEARCHDATA] as ISearchOption) => {
    let includeChild = true;
    let enableIncludeChild = false;
    config.idPath.forEach(item => {
        if (item.endsWith(".sy")) {
            includeChild = false;
        }
        if (item.split("/").length > 1) {
            enableIncludeChild = true;
        }
    });

    openModel({
        title: `<input id="toolbarSearch" placeholder="${window.siyuan.languages.showRecentUpdatedBlocks}" class="b3-text-field fn__block">`,
        icon: "iconSearch",
        html: `<div class="fn__flex-column" style="height: 100%">
    <div class="toolbar toolbar--border${config.hasReplace ? "" : " fn__none"}">
        <svg class="toolbar__icon"><use xlink:href="#iconReplace"></use></svg>
        <input id="toolbarReplace" class="b3-text-field fn__flex-1">
        <div class="fn__space"></div>
        <button class="b3-button b3-button--outline fn__flex-center">${window.siyuan.languages.replaceAll}</button>
        <div class="fn__space"></div>
        <button class="b3-button b3-button--outline fn__flex-center">${window.siyuan.languages.replace}</button>
        <div class="fn__space"></div>
    </div>
    <div id="criteria" style="background-color: var(--b3-theme-background);" class="b3-chips"></div>
    <div id="searchList" style="overflow:auto;" class="fn__flex-1"></div>
    <div id="searchPath" class="b3-chips${config.hPath ? "" : " fn__none"}" style="background-color: var(--b3-theme-background);">
        <div class="b3-chip b3-chip--middle">
            ${escapeHtml(config.hPath)}
            <svg data-type="remove-path" class="b3-chip__close"><use xlink:href="#iconCloseRound"></use></svg>
        </div>
    </div>
    <div class="toolbar">
        <span class="fn__flex-1"></span>
        <svg data-type="toggle-replace" class="toolbar__icon${config.hasReplace ? " toolbar__icon--active" : ""}"><use xlink:href="#iconReplace"></use></svg>
        <svg data-type="query" class="toolbar__icon"><use xlink:href="#iconRegex"></use></svg>
        <svg data-type="filter" class="toolbar__icon"><use xlink:href="#iconFilter"></use></svg>
        <svg ${enableIncludeChild ? "" : "disabled"} data-type="include" class="toolbar__icon${includeChild ? " toolbar__icon--active" : ""}"><use xlink:href="#iconCopy"></use></svg>
        <svg data-type="path" class="toolbar__icon"><use xlink:href="#iconFolder"></use></svg>
        <svg data-type="expand" class="toolbar__icon${config.group === 0 ? " fn__none" : ""}"><use xlink:href="#iconExpand"></use></svg>
        <svg data-type="contract" class="toolbar__icon${config.group === 0 ? " fn__none" : ""}"><use xlink:href="#iconContract"></use></svg>
        <svg data-type="more" class="toolbar__icon"><use xlink:href="#iconMore"></use></svg>
        <span class="fn__flex-1"></span>
     </div>
</div>`,
        bindEvent(element) {
            initSearchEvent(element.firstElementChild, config);
            toolbarSearchTimeout = updateSearchResult(config);
        }
    });
};
