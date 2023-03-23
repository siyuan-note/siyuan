import {getAllModels} from "../layout/getAll";
import {getInstanceById, getWndByLayout, resizeTabs, setPanelFocus} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Search} from "./index";
import {Wnd} from "../layout/Wnd";
import {Constants} from "../constants";
import {escapeAttr, escapeGreat, escapeHtml} from "../util/escape";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {showMessage} from "../dialog/message";
import {reloadProtyle} from "../protyle/util/reload";
import {MenuItem} from "../menus/Menu";
import {getDisplayName, getNotebookIcon, getNotebookName, movePathTo, pathPosix} from "../util/pathName";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {addLoading, setPadding} from "../protyle/ui/initUI";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {Dialog} from "../dialog";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {setStorageVal} from "../protyle/util/compatibility";

const appendCriteria = (element: HTMLElement, data: ISearchOption[]) => {
    fetchPost("/api/storage/getCriteria", {}, (response) => {
        let html = '';
        response.data.forEach((item: ISearchOption, index: number) => {
            data.push(item);
            html += `<div data-type="set-criteria" class="b3-chip b3-chip--middle b3-chip--pointer b3-chip--${['secondary', "primary", "info", "success", "warning", "error", ""][index % 7]}">${escapeHtml(item.name)}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`
        })
        element.innerHTML = html;
        if (html === "") {
            element.classList.add("fn__none")
        } else {
            element.classList.remove("fn__none")
        }
    });
}

const saveKeyList = (type: "keys" | "replaceKeys", value: string) => {
    let list: string[] = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS][type];
    list.splice(0, 0, value);
    list = Array.from(new Set(list));
    if (list.length > window.siyuan.config.search.limit) {
        list.splice(window.siyuan.config.search.limit, list.length - window.siyuan.config.search.limit);
    }
    // new Set 后需重新赋值
    window.siyuan.storage[Constants.LOCAL_SEARCHKEYS][type] = list;
    setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
};

export const openGlobalSearch = (text: string, replace: boolean) => {
    text = text.trim();
    let wnd: Wnd;
    const searchModel = getAllModels().search.find((item, index) => {
        if (index === 0) {
            wnd = item.parent.parent;
        }
        wnd.switchTab(item.parent.headElement);
        item.updateSearch(text, replace);
        return true;
    });
    if (searchModel) {
        return;
    }
    if (!wnd) {
        wnd = getWndByLayout(window.siyuan.layout.centerLayout);
    }
    const tab = new Tab({
        icon: "iconSearch",
        title: window.siyuan.languages.search,
        callback(tab) {
            const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
            const asset = new Search({
                tab,
                config: {
                    k: text,
                    r: "",
                    hasReplace: false,
                    method: localData.method,
                    hPath: "",
                    idPath: [],
                    group: localData.group,
                    sort: localData.sort,
                    types: localData.types,
                    removed: localData.removed
                }
            });
            tab.addModel(asset);
            resizeTabs();
        }
    });
    wnd.split("lr").addTab(tab);
    setPanelFocus(tab.panelElement);
};
// closeCB 不存在为页签搜索
export const genSearch = (config: ISearchOption, element: Element, closeCB?: () => void) => {
    let methodText = window.siyuan.languages.keyword;
    if (config.method === 1) {
        methodText = window.siyuan.languages.querySyntax;
    } else if (config.method === 2) {
        methodText = "SQL";
    } else if (config.method === 3) {
        methodText = window.siyuan.languages.regex;
    }
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
    const data = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    element.innerHTML = `<div class="fn__flex-column" style="height: 100%;${closeCB ? "border-radius: 4px;overflow: hidden;" : ""}">
    <div class="b3-form__icon search__header">
        <span class="fn__a" id="searchHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="searchInput" style="padding-right: 60px" class="b3-text-field b3-text-field--text">
        <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
        <div class="block__icons">
            <span id="searchReplace" aria-label="${window.siyuan.languages.replace}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconReplace"></use></svg>
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
            <span class="fn__space"></span>
            <span id="searchRefresh" aria-label="${window.siyuan.languages.refresh}" class="${closeCB ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </span>
            <span id="searchOpen" aria-label="${window.siyuan.languages.stickSearch}" class="${closeCB ? "" : "fn__none "}block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconLayoutRight"></use></svg>
            </span>
        </div>
    </div>
    <div class="b3-form__icon search__header${config.hasReplace ? "" : " fn__none"}">
        <span class="fn__a" id="replaceHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconReplace"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="replaceInput" class="b3-text-field b3-text-field--text">
        <svg class="fn__rotate fn__none svg" style="padding: 0 8px;align-self: center;"><use xlink:href="#iconRefresh"></use></svg>
        <button id="replaceAllBtn" class="b3-button b3-button--small b3-button--outline fn__flex-center">${window.siyuan.languages.replaceAll}</button>
        <div class="fn__space"></div>
        <button id="replaceBtn" class="b3-button b3-button--small b3-button--outline fn__flex-center">${window.siyuan.languages.replace}</button>
        <div class="fn__space"></div>
        <div id="replaceHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    </div>
    <div id="criteria" class="b3-chips" style="background-color: var(--b3-theme-background)"></div>
    <div class="search__header" style="padding: 4px 8px;">
        <span id="searchResult" class="search__result"></span>
        <span class="fn__space"></span>
        <span class="fn__flex-1"></span>
        <span id="searchPathInput" class="search__path ft__on-surface fn__flex-center ft__smaller fn__ellipsis" title="${escapeAttr(config.hPath)}">
            ${escapeHtml(config.hPath)}
            <svg class="search__rmpath${config.hPath ? "" : " fn__none"}"><use xlink:href="#iconCloseRound"></use></svg>
        </span>
        <span class="fn__space"></span>
        <button ${enableIncludeChild ? "" : "disabled"} id="searchInclude" class="b3-button b3-button--small${includeChild ? "" : " b3-button--cancel"}">${window.siyuan.languages.includeChildDoc}</button>
        <span class="fn__space"></span>
        <span id="searchPath" aria-label="${window.siyuan.languages.specifyPath}" class="block__icon b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        <div class="fn__flex${config.group === 0 ? " fn__none" : ""}">
            <span class="fn__space"></span>
            <span id="searchExpand" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.expand}">
                <svg><use xlink:href="#iconExpand"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchCollapse" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.collapse}">
                <svg><use xlink:href="#iconContract"></use></svg>
            </span>
        </div>
    </div>
    <div class="search__layout${(closeCB ? data.layout === 1 : data.layoutTab === 1) ? " search__layout--row" : ""}">
        <div id="searchList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
        <div class="search__drag"></div>
        <div id="searchPreview" class="fn__flex-1 search__preview"></div>
    </div>
</div>
<div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>`;

    const criteriaData: ISearchOption[] = []
    appendCriteria(element.querySelector("#criteria"), criteriaData);
    const searchPanelElement = element.querySelector("#searchList");
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;
    const replaceHistoryElement = element.querySelector("#replaceHistoryList");
    const historyElement = element.querySelector("#searchHistoryList");

    const lineHeight = 30;
    const edit = new Protyle(element.querySelector("#searchPreview") as HTMLElement, {
        blockId: "",
        render: {
            gutter: true,
            breadcrumbDocName: true
        },
    });
    if (window.siyuan.config.editor.readOnly) {
        disabledProtyle(edit.protyle);
    }
    if (closeCB) {
        if (data.layout === 1) {
            if (data.col) {
                edit.protyle.element.style.width = data.col;
                edit.protyle.element.classList.remove("fn__flex-1");
            }
        } else {
            if (data.row) {
                edit.protyle.element.classList.remove("fn__flex-1");
                edit.protyle.element.style.height = data.row;
            }
        }
    } else {
        if (data.layoutTab === 1) {
            if (data.colTab) {
                edit.protyle.element.style.width = data.colTab;
                edit.protyle.element.classList.remove("fn__flex-1");
            }
        } else {
            if (data.rowTab) {
                edit.protyle.element.classList.remove("fn__flex-1");
                edit.protyle.element.style.height = data.rowTab;
            }
        }
    }
    let clickTimeout: number;
    let inputTimeout: number;

    searchInputElement.value = config.k || "";
    replaceInputElement.value = config.r || "";
    searchInputElement.select();

    const dragElement = element.querySelector(".search__drag");
    dragElement.addEventListener("mousedown", (event: MouseEvent) => {
        const documentSelf = document;
        const nextElement = dragElement.nextElementSibling as HTMLElement;
        const previousElement = dragElement.previousElementSibling as HTMLElement;
        const direction = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS][closeCB ? "layout" : "layoutTab"] === 1 ? "lr" : "tb";
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
            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS][direction === "lr" ? (closeCB ? "col" : "colTab") : (closeCB ? "row" : "rowTab")] = nextElement[direction === "lr" ? "clientWidth" : "clientHeight"] + "px";
            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
            if (direction === "lr") {
                setPadding(edit.protyle);
            }
        };
    });

    element.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        const searchPathInputElement = element.querySelector("#searchPathInput");
        while (target && !target.isSameNode(element)) {
            if (target.classList.contains("b3-chip") && target.getAttribute("data-type") === "set-criteria") {
                config.removed = false;
                criteriaData.find(item => {
                    if (item.name === target.innerText.trim()) {
                        updateConfig(element, item, config, edit);
                        return true;
                    }
                })
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-chip__close") && target.getAttribute("data-type") === "remove-criteria") {
                const name = target.parentElement.innerText.trim()
                fetchPost("/api/storage/removeCriterion", {name});
                criteriaData.find((item, index) => {
                    if (item.name === name) {
                        criteriaData.splice(index, 1);
                        return true;
                    }
                })
                if (target.parentElement.parentElement.childElementCount === 1) {
                    target.parentElement.parentElement.classList.add("fn__none");
                    target.parentElement.remove();
                } else {
                    target.parentElement.remove();
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("search__rmpath")) {
                config.idPath = [];
                config.hPath = "";
                searchPathInputElement.innerHTML = config.hPath;
                searchPathInputElement.setAttribute("title", "");
                inputTimeout = inputEvent(element, config, inputTimeout, edit);
                const includeElement = element.querySelector("#searchInclude");
                includeElement.classList.remove("b3-button--cancel");
                includeElement.setAttribute("disabled", "disabled");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchExpand") {
                Array.from(searchPanelElement.children).forEach(item => {
                    if (item.classList.contains("b3-list-item")) {
                        item.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.remove("fn__none");
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchCollapse") {
                Array.from(searchPanelElement.children).forEach(item => {
                    if (item.classList.contains("b3-list-item")) {
                        item.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.add("fn__none");
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchPath") {
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
                        searchPathInputElement.innerHTML = `${escapeHtml(config.hPath)}<svg class="search__rmpath"><use xlink:href="#iconCloseRound"></use></svg>`;
                        searchPathInputElement.setAttribute("title", config.hPath);
                        const includeElement = element.querySelector("#searchInclude");
                        includeElement.classList.remove("b3-button--cancel");
                        if (enableIncludeChild) {
                            includeElement.removeAttribute("disabled");
                        } else {
                            includeElement.setAttribute("disabled", "disabled");
                        }
                        inputTimeout = inputEvent(element, config, inputTimeout, edit);
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
                inputTimeout = inputEvent(element, config, inputTimeout, edit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchReplace") {
                // ctrl+P 不需要保存
                config.hasReplace = !config.hasReplace;
                element.querySelector("#replaceHistoryBtn").parentElement.classList.toggle("fn__none");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchOpen") {
                let wnd: Wnd;
                const element = document.querySelector(".layout__wnd--active");
                if (element) {
                    wnd = getInstanceById(element.getAttribute("data-id")) as Wnd;
                }
                if (!wnd) {
                    wnd = getWndByLayout(window.siyuan.layout.centerLayout);
                }
                const tab = new Tab({
                    icon: "iconSearch",
                    title: window.siyuan.languages.search,
                    callback(tab) {
                        config.k = searchInputElement.value;
                        config.r = replaceInputElement.value;
                        const asset = new Search({
                            tab,
                            config
                        });
                        tab.addModel(asset);
                        resizeTabs();
                    }
                });
                wnd.split("lr").addTab(tab);
                if (closeCB) {
                    closeCB();
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchRefresh") {
                inputTimeout = inputEvent(element, config, inputTimeout, edit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchMore") {
                addConfigMoreMenu(config, edit, element, event, criteriaData);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchFilter") {
                addConfigFilterMenu(config, edit, element);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchSyntaxCheck") {
                window.siyuan.menus.menu.remove();
                addQueryMenu(config, edit, element);
                window.siyuan.menus.menu.popup({x: event.clientX - 16, y: event.clientY - 16}, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchHistoryBtn") {
                const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
                if (!list.keys || list.keys.length === 0) {
                    return;
                }
                let html = "";
                list.keys.forEach((s: string) => {
                    if (s !== searchInputElement.value) {
                        html += `<div class="b3-list-item">${escapeHtml(s)}</div>`;
                    }
                });
                if (html === "") {
                    return;
                }
                historyElement.classList.remove("fn__none");
                historyElement.innerHTML = html;
                replaceHistoryElement.classList.add("fn__none");
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceHistoryBtn") {
                const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
                if (!list.replaceKeys || list.replaceKeys.length === 0) {
                    return;
                }
                let html = "";
                list.replaceKeys.forEach((s: string) => {
                    if (s !== replaceInputElement.value) {
                        html += `<div class="b3-list-item">${escapeHtml(s)}</div>`;
                    }
                });
                if (html === "") {
                    return;
                }
                replaceHistoryElement.classList.remove("fn__none");
                replaceHistoryElement.innerHTML = html;
                historyElement.classList.add("fn__none");
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceAllBtn") {
                replace(element, config, edit, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "replaceBtn") {
                replace(element, config, edit, false);
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
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                } else if (target.parentElement.id === "replaceHistoryList") {
                    replaceInputElement.value = target.textContent;
                    replaceHistoryElement.classList.add("fn__none");
                } else if (target.getAttribute("data-type") === "search-item") {
                    if (event.detail === 1) {
                        clickTimeout = window.setTimeout(() => {
                            if (event.altKey) {
                                const id = target.getAttribute("data-node-id");
                                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                                    openFileById({
                                        id,
                                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                                        zoomIn: foldResponse.data,
                                        position: "right"
                                    });
                                    if (closeCB) {
                                        closeCB();
                                    }
                                });
                            } else if (!target.classList.contains("b3-list-item--focus")) {
                                searchPanelElement.querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                                target.classList.add("b3-list-item--focus");
                                getArticle({
                                    edit,
                                    id: target.getAttribute("data-node-id"),
                                    k: getKey(target)
                                });
                                searchInputElement.focus();
                            } else if (target.classList.contains("b3-list-item--focus")) {
                                renderNextSearchMark({
                                    edit,
                                    id: target.getAttribute("data-node-id"),
                                    target,
                                });
                                searchInputElement.focus();
                            }
                        }, Constants.TIMEOUT_DBLCLICK);
                    } else if (event.detail === 2 && !event.ctrlKey) {
                        clearTimeout(clickTimeout);
                        const id = target.getAttribute("data-node-id");
                        fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                            openFileById({
                                id,
                                action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                                zoomIn: foldResponse.data
                            });
                            if (closeCB) {
                                closeCB();
                            }
                        });
                    }
                    window.siyuan.menus.menu.remove();
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
        historyElement.classList.add("fn__none");
        replaceHistoryElement.classList.add("fn__none");
    }, false);

    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        inputTimeout = inputEvent(element, config, inputTimeout, edit, event);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        inputTimeout = inputEvent(element, config, inputTimeout, edit, event);
    });
    searchInputElement.addEventListener("blur", () => {
        if (config.removed) {
            config.k = searchInputElement.value;
            window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
            setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
        }
        saveKeyList("keys", searchInputElement.value);
    });
    searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
        if (!currentList || event.isComposing) {
            return;
        }
        if (event.key === "ArrowDown") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.nextElementSibling) {
                if (config.group === 1) {
                    if (currentList.parentElement.nextElementSibling) {
                        currentList.parentElement.nextElementSibling.nextElementSibling.firstElementChild.classList.add("b3-list-item--focus");
                    } else {
                        searchPanelElement.children[1].firstElementChild.classList.add("b3-list-item--focus");
                    }
                } else {
                    searchPanelElement.firstElementChild.classList.add("b3-list-item--focus");
                }
            } else {
                currentList.nextElementSibling.classList.add("b3-list-item--focus");
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop) {
                searchPanelElement.scrollTop = currentList.offsetTop - searchPanelElement.clientHeight + lineHeight;
            }
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                k: getKey(currentList),
                edit
            });
            event.preventDefault();
        } else if (event.key === "ArrowUp") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.previousElementSibling) {
                if (config.group === 1) {
                    if (currentList.parentElement.previousElementSibling.previousElementSibling) {
                        currentList.parentElement.previousElementSibling.previousElementSibling.lastElementChild.classList.add("b3-list-item--focus");
                    } else {
                        searchPanelElement.lastElementChild.lastElementChild.classList.add("b3-list-item--focus");
                    }
                } else {
                    searchPanelElement.lastElementChild.classList.add("b3-list-item--focus");
                }
            } else {
                currentList.previousElementSibling.classList.add("b3-list-item--focus");
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop - lineHeight * 2) {
                searchPanelElement.scrollTop = currentList.offsetTop - lineHeight * 2;
            }
            getArticle({
                id: currentList.getAttribute("data-node-id"),
                k: getKey(currentList),
                edit
            });
            event.preventDefault();
        } else if (event.key === "Enter") {
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                openFileById({
                    id,
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: foldResponse.data
                });
                if (closeCB) {
                    closeCB();
                }
            });
            event.preventDefault();
        }
    });
    replaceInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        replace(element, config, edit, false);
        event.preventDefault();
    });
    inputTimeout = inputEvent(element, config, inputTimeout, edit);
    return edit;
};

const addConfigMoreMenu = async (config: ISearchOption, edit: Protyle, element: Element, event: MouseEvent, criteriaData: ISearchOption[]) => {
    window.siyuan.menus.menu.remove();
    const sortMenu = [{
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.type,
        current: config.sort === 0,
        click() {
            config.sort = 0;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.createdASC,
        current: config.sort === 1,
        click() {
            config.sort = 1;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.createdDESC,
        current: config.sort === 2,
        click() {
            config.sort = 2;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedASC,
        current: config.sort === 3,
        click() {
            config.sort = 3;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.modifiedDESC,
        current: config.sort === 4,
        click() {
            config.sort = 4;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankAsc,
        current: config.sort === 6,
        click() {
            config.sort = 6;
            inputEvent(element, config, undefined, edit);
        }
    }, {
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sortByRankDesc,
        current: config.sort === 7,
        click() {
            config.sort = 7;
            inputEvent(element, config, undefined, edit);
        }
    }];
    if (config.group === 1) {
        sortMenu.push({
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.sortByContent,
            current: config.sort === 5,
            click() {
                config.sort = 5;
                inputEvent(element, config, undefined, edit);
            }
        });
    }
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.sort,
        type: "submenu",
        submenu: sortMenu,
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.group,
        type: "submenu",
        submenu: [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.noGroupBy,
            current: config.group === 0,
            click() {
                element.querySelector("#searchCollapse").parentElement.classList.add("fn__none");
                config.group = 0;
                if (config.sort === 5) {
                    config.sort = 0;
                }
                inputEvent(element, config, undefined, edit);
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.groupByDoc,
            current: config.group === 1,
            click() {
                element.querySelector("#searchCollapse").parentElement.classList.remove("fn__none");
                config.group = 1;
                inputEvent(element, config, undefined, edit);
            }
        }]
    }).element);
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    const isPopover = hasClosestByClassName(element, "b3-dialog__container");
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.layout,
        type: "submenu",
        submenu: [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.topBottomLayout,
            current: isPopover ? localData.layout === 0 : localData.layoutTab === 0,
            click() {
                element.querySelector(".search__layout").classList.remove("search__layout--row");
                edit.protyle.element.style.width = "";
                if ((isPopover && localData.row) || (!isPopover && localData.rowTab)) {
                    edit.protyle.element.style.height = isPopover ? localData.row : localData.rowTab;
                    edit.protyle.element.classList.remove("fn__flex-1");
                } else {
                    edit.protyle.element.classList.add("fn__flex-1");
                }
                setPadding(edit.protyle);
                if (isPopover) {
                    localData.layout = 0;
                } else {
                    localData.layoutTab = 0;
                }
                setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.leftRightLayout,
            current: isPopover ? localData.layout === 1 : localData.layoutTab === 1,
            click() {
                element.querySelector(".search__layout").classList.add("search__layout--row");
                edit.protyle.element.style.height = "";
                if ((isPopover && localData.col) || (!isPopover && localData.colTab)) {
                    edit.protyle.element.style.width = isPopover ? localData.col : localData.colTab;
                    edit.protyle.element.classList.remove("fn__flex-1");
                } else {
                    edit.protyle.element.classList.add("fn__flex-1");
                }
                setPadding(edit.protyle);
                if (isPopover) {
                    localData.layout = 1;
                } else {
                    localData.layoutTab = 1;
                }
                setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
            }
        }]
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.saveCriterion,
        iconHTML: Constants.ZWSP,
        click() {
            const saveDialog = new Dialog({
                title: window.siyuan.languages.saveCriterion,
                content: `<div class="b3-dialog__content">
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.memo}">
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: "520px",
            });
            const btnsElement = saveDialog.element.querySelectorAll(".b3-button");
            saveDialog.bindInput(saveDialog.element.querySelector("input"), () => {
                btnsElement[1].dispatchEvent(new CustomEvent("click"));
            });
            btnsElement[0].addEventListener("click", () => {
                saveDialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                const value = saveDialog.element.querySelector("input").value;
                if (!value) {
                    showMessage(window.siyuan.languages["_kernel"]["142"]);
                    return;
                }
                config.k = (element.querySelector("#searchInput") as HTMLInputElement).value;
                config.r = (element.querySelector("#replaceInput") as HTMLInputElement).value;
                const criterion = config;
                criterion.name = value;
                criteriaData.push(Object.assign({}, criterion));
                fetchPost("/api/storage/setCriterion", {criterion}, () => {
                    saveDialog.destroy();
                    const criteriaElement = element.querySelector("#criteria")
                    criteriaElement.classList.remove("fn__none");
                    criteriaElement.insertAdjacentHTML("beforeend", `<div data-type="set-criteria" class="b3-chip b3-chip--middle b3-chip--pointer b3-chip--${['secondary', "primary", "info", "success", "warning", "error", ""][(criteriaElement.childElementCount) % 7]}">${criterion.name}<svg class="b3-chip__close" data-type="remove-criteria"><use xlink:href="#iconCloseRound"></use></svg></div>`)
                });
            });
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.removeCriterion,
        click() {
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
            }, config, edit);
        }
    }).element);
    window.siyuan.menus.menu.popup({x: event.clientX - 16, y: event.clientY - 16}, true);
};

const updateConfig = (element: Element, item: ISearchOption, config: ISearchOption, edit: Protyle) => {
    const dialogElement = hasClosestByClassName(element, "b3-dialog--open");
    if (dialogElement && dialogElement.getAttribute("data-key") === window.siyuan.config.keymap.general.search.custom) {
        // https://github.com/siyuan-note/siyuan/issues/6828
        item.hPath = config.hPath;
        item.idPath = config.idPath.join(",").split(",");
    }
    if (config.hasReplace !== item.hasReplace) {
        if (item.hasReplace) {
            element.querySelector("#replaceHistoryBtn").parentElement.classList.remove("fn__none");
        } else {
            element.querySelector("#replaceHistoryBtn").parentElement.classList.add("fn__none");
        }
    }
    const searchPathInputElement = element.querySelector("#searchPathInput")
    if (item.hPath) {
        searchPathInputElement.innerHTML = `${escapeHtml(item.hPath)}<svg class="search__rmpath"><use xlink:href="#iconCloseRound"></use></svg>`;
        searchPathInputElement.setAttribute("title", item.hPath);
    } else {
        searchPathInputElement.innerHTML = "";
        searchPathInputElement.setAttribute("title", "");
    }
    if (config.group !== item.group) {
        if (item.group === 0) {
            element.querySelector("#searchExpand").parentElement.classList.add("fn__none");
        } else {
            element.querySelector("#searchExpand").parentElement.classList.remove("fn__none");
        }
    }
    let includeChild = true;
    let enableIncludeChild = false;
    item.idPath.forEach(item => {
        if (item.endsWith(".sy")) {
            includeChild = false;
        }
        if (item.split("/").length > 1) {
            enableIncludeChild = true;
        }
    });
    const searchIncludeElement = element.querySelector("#searchInclude");
    if (includeChild) {
        searchIncludeElement.classList.remove("b3-button--cancel");
    } else {
        searchIncludeElement.classList.add("b3-button--cancel");
    }
    if (enableIncludeChild) {
        searchIncludeElement.removeAttribute("disabled");
    } else {
        searchIncludeElement.setAttribute("disabled", "disabled");
    }
    (element.querySelector("#searchInput") as HTMLInputElement).value = item.k;
    (element.querySelector("#replaceInput") as HTMLInputElement).value = item.r;
    let methodTip = window.siyuan.languages.searchMethod + " ";
    switch (item.method) {
        case 0:
            methodTip += window.siyuan.languages.keyword;
            break;
        case 1:
            methodTip += window.siyuan.languages.querySyntax;
            break;
        case 2:
            methodTip += "SQL";
            break;
        case 3:
            methodTip += window.siyuan.languages.regex;
            break;
    }
    element.querySelector("#searchSyntaxCheck").setAttribute("aria-label", methodTip);
    Object.assign(config, item);
    window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
    setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
    inputEvent(element, config, undefined, edit);
    window.siyuan.menus.menu.remove();
};

const addConfigFilterMenu = (config: ISearchOption, edit: Protyle, element: Element) => {
    const filterDialog = new Dialog({
        title: window.siyuan.languages.type,
        content: `<div class="b3-dialog__content" style="height:calc(70vh - 45px);overflow: auto">
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconMath"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.math}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="mathBlock" type="checkbox"${config.types.mathBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconTable"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.table}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="table" type="checkbox"${config.types.table ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconQuote"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.quote}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="blockquote" type="checkbox"${config.types.blockquote ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSuper"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.superBlock}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="superBlock" type="checkbox"${config.types.superBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconParagraph"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.paragraph}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="paragraph" type="checkbox"${config.types.paragraph ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconFile"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.doc}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="document" type="checkbox"${config.types.document ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHeadings"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.headings}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="heading" type="checkbox"${config.types.heading ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconList"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.list1}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="list" type="checkbox"${config.types.list ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconListItem"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.listItem}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="listItem" type="checkbox"${config.types.listItem ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconCode"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.code}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="codeBlock" type="checkbox"${config.types.codeBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconHTML5"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            HTML
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="htmlBlock" type="checkbox"${config.types.htmlBlock ? " checked" : ""}>
    </label>
    <label class="fn__flex b3-label">
        <svg class="ft__on-surface svg fn__flex-center"><use xlink:href="#iconSQL"></use></svg>
        <span class="fn__space"></span>
        <div class="fn__flex-1 fn__flex-center">
            ${window.siyuan.languages.embedBlock}
        </div>
        <span class="fn__space"></span>
        <input id="removeAssets" class="b3-switch fn__flex-center" data-type="embedBlock" type="checkbox"${config.types.embedBlock ? " checked" : ""}>
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: "520px",
    });
    const btnsElement = filterDialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        filterDialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        filterDialog.element.querySelectorAll(".b3-switch").forEach((item: HTMLInputElement) => {
            config.types[item.getAttribute("data-type") as TSearchFilter] = item.checked;
        });
        inputEvent(element, config, undefined, edit);
        filterDialog.destroy();
    });
};

const addQueryMenu = (config: ISearchOption, edit: Protyle, element: Element) => {
    const searchSyntaxCheckElement = element.querySelector("#searchSyntaxCheck");
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.keyword,
        current: config.method === 0,
        click() {
            config.method = 0;
            searchSyntaxCheckElement.setAttribute("aria-label", `${window.siyuan.languages.searchMethod} ${window.siyuan.languages.keyword}`);
            inputEvent(element, config, undefined, edit);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.querySyntax,
        current: config.method === 1,
        click() {
            config.method = 1;
            searchSyntaxCheckElement.setAttribute("aria-label", `${window.siyuan.languages.searchMethod} ${window.siyuan.languages.querySyntax}`);
            inputEvent(element, config, undefined, edit);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: "SQL",
        current: config.method === 2,
        click() {
            config.method = 2;
            searchSyntaxCheckElement.setAttribute("aria-label", `${window.siyuan.languages.searchMethod} SQL`);
            inputEvent(element, config, undefined, edit);
        }
    }).element);
    window.siyuan.menus.menu.append(new MenuItem({
        iconHTML: Constants.ZWSP,
        label: window.siyuan.languages.regex,
        current: config.method === 3,
        click() {
            config.method = 3;
            searchSyntaxCheckElement.setAttribute("aria-label", `${window.siyuan.languages.searchMethod} ${window.siyuan.languages.regex}`);
            inputEvent(element, config, undefined, edit);
        }
    }).element);
};

const getKey = (element: HTMLElement) => {
    const keys: string[] = [];
    element.querySelectorAll("mark").forEach(item => {
        keys.push(item.textContent);
    });
    return [...new Set(keys)].join(" ");
};

const renderNextSearchMark = (options: {
    id: string,
    edit: Protyle,
    target: Element,
}) => {
    let matchElement;
    const allMatchElements = Array.from(options.edit.protyle.wysiwyg.element.querySelectorAll(`div[data-node-id="${options.id}"] span[data-type~="search-mark"]`));
    allMatchElements.find((item, itemIndex) => {
        if (item.classList.contains("search-mark--hl")) {
            item.classList.remove("search-mark--hl");
            matchElement = allMatchElements[itemIndex + 1];
            return;
        }
    });
    if (!matchElement) {
        matchElement = allMatchElements[0];
    }
    if (matchElement) {
        matchElement.classList.add("search-mark--hl");
        const contentRect = options.edit.protyle.contentElement.getBoundingClientRect();
        options.edit.protyle.contentElement.scrollTop = options.edit.protyle.contentElement.scrollTop + matchElement.getBoundingClientRect().top - contentRect.top - contentRect.height / 2;
    }
};

const getArticle = (options: {
    id: string,
    k: string,
    edit: Protyle
}) => {
    fetchPost("/api/block/checkBlockFold", {id: options.id}, (foldResponse) => {
        options.edit.protyle.scroll.lastScrollTop = 0;
        addLoading(options.edit.protyle);
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            k: options.k,
            mode: foldResponse.data ? 0 : 3,
            size: foldResponse.data ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
            zoom: foldResponse.data,
        }, getResponse => {
            onGet(getResponse, options.edit.protyle, foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_HL, Constants.CB_GET_HTML]);
            const matchElement = options.edit.protyle.wysiwyg.element.querySelector(`div[data-node-id="${options.id}"] span[data-type~="search-mark"]`);
            if (matchElement) {
                matchElement.classList.add("search-mark--hl");
                const contentRect = options.edit.protyle.contentElement.getBoundingClientRect();
                options.edit.protyle.contentElement.scrollTop = options.edit.protyle.contentElement.scrollTop + matchElement.getBoundingClientRect().top - contentRect.top - contentRect.height / 2;
            }
            const exitFocusElement = options.edit.protyle.breadcrumb.element.parentElement.querySelector('[data-type="exit-focus"]');
            if (!foldResponse.data) {
                exitFocusElement.classList.add("fn__none");
                exitFocusElement.nextElementSibling.classList.add("fn__none");
            } else {
                exitFocusElement.classList.remove("fn__none");
                exitFocusElement.nextElementSibling.classList.remove("fn__none");
            }
        });
    });
};

const replace = (element: Element, config: ISearchOption, edit: Protyle, isAll: boolean) => {
    if (config.method === 1 || config.method === 2) {
        showMessage(window.siyuan.languages._kernel[132]);
        return;
    }
    const searchPanelElement = element.querySelector("#searchList");
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;

    const loadElement = replaceInputElement.nextElementSibling;
    if (!loadElement.classList.contains("fn__none")) {
        return;
    }
    saveKeyList("replaceKeys", replaceInputElement.value);
    let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
    if (!currentList) {
        return;
    }
    loadElement.classList.remove("fn__none");
    let ids: string[] = [];
    let rootIds: string[] = [];
    if (isAll) {
        searchPanelElement.querySelectorAll('.b3-list-item[data-type="search-item"]').forEach(item => {
            ids.push(item.getAttribute("data-node-id"));
            rootIds.push(item.getAttribute("data-root-id"));
        });
    } else {
        ids = [currentList.getAttribute("data-node-id")];
        rootIds = [currentList.getAttribute("data-root-id")];
    }
    fetchPost("/api/search/findReplace", {
        k: config.method === 0 ? getKey(currentList) : (element.querySelector("#searchInput") as HTMLInputElement).value,
        r: replaceInputElement.value,
        ids,
        types: config.types,
        method: config.method,
    }, (response) => {
        loadElement.classList.add("fn__none");
        if (response.code === 1) {
            showMessage(response.msg);
            return;
        }
        if (ids.length > 1) {
            return;
        }
        getAllModels().editor.forEach(item => {
            if (rootIds[0] === item.editor.protyle.block.rootID) {
                reloadProtyle(item.editor.protyle);
            }
        });
        if (!currentList.nextElementSibling && searchPanelElement.children[0]) {
            searchPanelElement.children[0].classList.add("b3-list-item--focus");
        } else {
            currentList.nextElementSibling.classList.add("b3-list-item--focus");
        }
        currentList.remove();
        if (searchPanelElement.childElementCount === 0) {
            searchPanelElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            edit.protyle.element.classList.add("fn__none");
            return;
        }
        currentList = searchPanelElement.querySelector(".b3-list-item--focus");
        if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + 30 ||
            searchPanelElement.scrollTop > currentList.offsetTop) {
            searchPanelElement.scrollTop = currentList.offsetTop - searchPanelElement.clientHeight + 30;
        }
        getArticle({
            edit,
            id: currentList.getAttribute("data-node-id"),
            k: getKey(currentList)
        });
    });
};

const inputEvent = (element: Element, config: ISearchOption, inputTimeout: number, edit: Protyle, event?: InputEvent) => {
    if (event && event.isComposing) {
        return;
    }
    clearTimeout(inputTimeout);
    inputTimeout = window.setTimeout(() => {
        const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
        const loadingElement = element.querySelector(".fn__loading--top");
        loadingElement.classList.remove("fn__none");
        const inputValue = searchInputElement.value;
        element.querySelector("#searchList").scrollTo(0, 0);
        if (inputValue === "" && (!config.idPath || config.idPath.length === 0)) {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onSearch(response.data, edit, element);
                loadingElement.classList.add("fn__none");
                element.querySelector("#searchResult").innerHTML = "";
            });
        } else {
            fetchPost("/api/search/fullTextSearchBlock", {
                query: inputValue,
                method: config.method,
                types: config.types,
                paths: config.idPath || [],
                groupBy: config.group,
                orderBy: config.sort,
            }, (response) => {
                onSearch(response.data.blocks, edit, element);
                element.querySelector("#searchResult").innerHTML = window.siyuan.languages.findInDoc.replace("${x}", response.data.matchedRootCount).replace("${y}", response.data.matchedBlockCount);
                loadingElement.classList.add("fn__none");
            });
        }
    }, Constants.TIMEOUT_SEARCH);
    return inputTimeout;
};

const onSearch = (data: IBlock[], edit: Protyle, element: Element) => {
    let resultHTML = "";
    data.forEach((item, index) => {
        const title = getNotebookName(item.box) + getDisplayName(item.hPath, false);
        if (item.children) {
            resultHTML += `<div class="b3-list-item">
<span class="b3-list-item__toggle b3-list-item__toggle--hl">
    <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
</span>
${unicode2Emoji(getNotebookIcon(item.box) || Constants.SIYUAN_IMAGE_NOTE, false, "b3-list-item__graphic", true)}
<span class="b3-list-item__text" title="${title}">${title}</span>
</div><div>`;
            item.children.forEach((childItem, childIndex) => {
                resultHTML += `<div style="padding-left: 22px" data-type="search-item" class="b3-list-item${childIndex === 0 && index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${childItem.id}" data-root-id="${childItem.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(childItem.type)}"></use></svg>
${unicode2Emoji(childItem.ial.icon, false, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${childItem.content}</span>
</div>`;
            });
            resultHTML += "</div>";
        } else {
            resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${item.id}" data-root-id="${item.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
${unicode2Emoji(item.ial.icon, false, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${item.content}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis" title="${escapeAttr(title)}">${escapeGreat(title)}</span>
</div>`;
        }
    });

    if (data[0]) {
        edit.protyle.element.classList.remove("fn__none");
        const contentElement = document.createElement("div");
        if (data[0].children) {
            contentElement.innerHTML = data[0].children[0].content;
            getArticle({
                edit,
                id: data[0].children[0].id,
                k: getKey(contentElement),
            });
        } else {
            contentElement.innerHTML = data[0].content;
            getArticle({
                edit,
                id: data[0].id,
                k: getKey(contentElement),
            });
        }
    } else {
        edit.protyle.element.classList.add("fn__none");
    }
    element.querySelector("#searchList").innerHTML = resultHTML || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
};
