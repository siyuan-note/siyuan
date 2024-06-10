import {getAllModels} from "../layout/getAll";
/// #if !BROWSER
import * as path from "path";
/// #endif
import {Constants} from "../constants";
import {escapeAriaLabel, escapeGreat, escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {openFile, openFileById} from "../editor/util";
import {showMessage} from "../dialog/message";
import {reloadProtyle} from "../protyle/util/reload";
import {MenuItem} from "../menus/Menu";
import {
    getDisplayName,
    getNotebookIcon,
    getNotebookName,
    movePathTo,
    pathPosix,
    showFileInFolder
} from "../util/pathName";
import {Protyle} from "../protyle";
import {onGet} from "../protyle/util/onGet";
import {addLoading} from "../protyle/ui/initUI";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {isNotCtrl, isMac, setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {newFileByName} from "../util/newFile";
import {
    filterMenu,
    getKeyByLiElement,
    initCriteriaMenu,
    moreMenu,
    queryMenu,
    replaceFilterMenu,
    saveCriterion
} from "./menu";
import {App} from "../index";
import {
    assetFilterMenu,
    assetInputEvent,
    assetMethodMenu,
    assetMoreMenu,
    openSearchAsset,
    renderNextAssetMark,
    renderPreview,
    toggleAssetHistory
} from "./assets";
import {resize} from "../protyle/util/resize";
import {Menu} from "../plugin/Menu";
import {addClearButton} from "../util/addClearButton";
import {checkFold} from "../util/noRelyPCFunction";
import {getUnRefList, openSearchUnRef, unRefMoreMenu} from "./unRef";
import {getDefaultType} from "./getDefault";

export const toggleReplaceHistory = (searchElement: Element) => {
    const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    if (!list.replaceKeys || list.replaceKeys.length === 0) {
        return;
    }
    const menu = new Menu("search-replace-history");
    if (menu.isOpen) {
        return;
    }
    menu.element.classList.add("b3-menu--list");
    menu.addItem({
        iconHTML: "",
        label: window.siyuan.languages.clearHistory,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].replaceKeys = [];
            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
        }
    });
    const separatorElement = menu.addSeparator(1);
    let current = true;
    const replaceInputElement = searchElement.querySelector("#replaceInput") as HTMLInputElement;
    list.replaceKeys.forEach((s: string) => {
        if (s !== replaceInputElement.value && s) {
            const menuItem = menu.addItem({
                iconHTML: "",
                label: escapeHtml(s),
                action: "iconCloseRound",
                bind(element) {
                    element.addEventListener("click", (itemEvent) => {
                        if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                            list.replaceKeys.find((item: string, index: number) => {
                                if (item === s) {
                                    list.replaceKeys.splice(index, 1);
                                    return true;
                                }
                            });
                            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].replaceKeys = list.replaceKeys;
                            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                window.siyuan.menus.menu.remove();
                            } else {
                                element.remove();
                            }
                        } else {
                            replaceInputElement.value = element.textContent;
                            window.siyuan.menus.menu.remove();
                        }
                        itemEvent.preventDefault();
                        itemEvent.stopPropagation();
                    });
                }
            });
            if (current) {
                menuItem.classList.add("b3-menu__item--current");
            }
            current = false;
        }
    });
    if (current) {
        separatorElement.remove();
    }
    const rect = replaceInputElement.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const toggleSearchHistory = (searchElement: Element, config: Config.IUILayoutTabSearchConfig, edit: Protyle) => {
    const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    if (!list.keys || list.keys.length === 0) {
        return;
    }
    const menu = new Menu("search-history");
    if (menu.isOpen) {
        return;
    }
    menu.element.classList.add("b3-menu--list");
    menu.addItem({
        iconHTML: "",
        label: window.siyuan.languages.clearHistory,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].keys = [];
            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
        }
    });
    const separatorElement = menu.addSeparator(1);
    let current = true;
    const searchInputElement = searchElement.querySelector("#searchInput") as HTMLInputElement;
    list.keys.forEach((s: string) => {
        if (s !== searchInputElement.value && s) {
            const menuItem = menu.addItem({
                iconHTML: "",
                label: escapeHtml(s),
                action: "iconCloseRound",
                bind(element) {
                    element.addEventListener("click", (itemEvent) => {
                        if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                            list.keys.find((item: string, index: number) => {
                                if (item === s) {
                                    list.keys.splice(index, 1);
                                    return true;
                                }
                            });
                            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].keys = list.keys;
                            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                window.siyuan.menus.menu.remove();
                            } else {
                                element.remove();
                            }
                        } else {
                            searchInputElement.value = element.textContent;
                            config.page = 1;
                            inputEvent(searchElement, config, edit, true);
                            window.siyuan.menus.menu.remove();
                        }
                        itemEvent.preventDefault();
                        itemEvent.stopPropagation();
                    });
                }
            });
            if (current) {
                menuItem.classList.add("b3-menu__item--current");
            }
            current = false;
        }
    });
    if (current) {
        separatorElement.remove();
    }
    const rect = searchInputElement.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

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

export const openGlobalSearch = (app: App, text: string, replace: boolean) => {
    text = text.trim();
    const searchModel = getAllModels().search.find((item) => {
        item.parent.parent.switchTab(item.parent.headElement);
        item.updateSearch(text, replace);
        return true;
    });
    if (searchModel) {
        return;
    }
    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
    openFile({
        app,
        searchData: {
            k: text,
            r: "",
            hasReplace: false,
            method: localData.method,
            hPath: "",
            idPath: [],
            group: localData.group,
            sort: localData.sort,
            types: Object.assign({}, localData.types),
            replaceTypes: Object.assign({}, localData.replaceTypes),
            removed: localData.removed,
            page: 1
        },
        position: (window.siyuan.layout.centerLayout.children.length > 1 || window.innerWidth > 1024) ? "right" : undefined
    });
};

// closeCB 不存在为页签搜索
export const genSearch = (app: App, config: Config.IUILayoutTabSearchConfig, element: Element, closeCB?: () => void) => {
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
    const unRefLocal = window.siyuan.storage[Constants.LOCAL_SEARCHUNREF];
    element.innerHTML = `<div class="fn__flex-column" style="height: 100%;${closeCB ? "border-radius: var(--b3-border-radius-b);overflow: hidden;" : ""}">
    <div class="block__icons" style="overflow: auto">
        <span data-position="9bottom" data-type="previous" class="block__icon block__icon--show ariaLabel" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-position="9bottom" data-type="next" class="block__icon block__icon--show ariaLabel" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span id="searchResult" class="fn__flex-shrink ft__selectnone"></span>
        <span class="fn__space"></span>
        <span class="fn__flex-1${closeCB ? " resize__move" : ""}" style="min-height: 100%"></span>
        <span id="searchPathInput" data-position="9bottom" class="search__path ft__on-surface fn__flex-center ft__smaller fn__ellipsis ariaLabel" aria-label="${escapeAriaLabel(config.hPath)}">
            ${escapeHtml(config.hPath)}
            <svg class="search__rmpath${config.hPath ? "" : " fn__none"}"><use xlink:href="#iconCloseRound"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span data-position="9bottom" id="searchInclude" ${enableIncludeChild ? "" : "disabled"} aria-label="${window.siyuan.languages.includeChildDoc}" class="block__icon block__icon--show ariaLabel">
            <svg${includeChild ? ' class="ft__primary"' : ""}><use xlink:href="#iconCopy"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchPath" aria-label="${window.siyuan.languages.specifyPath}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchMore" aria-label="${window.siyuan.languages.more}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconMore"></use></svg>
        </span>
        <span class="${closeCB ? "" : "fn__none "}fn__space"></span>
        <span id="searchOpen" aria-label="${window.siyuan.languages.openInNewTab}" class="${closeCB ? "" : "fn__none "}block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconLayoutRight"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchUnRef" aria-label="${window.siyuan.languages.listInvalidRefBlocks}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconLinkOff"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchAsset" aria-label="${window.siyuan.languages.searchAssetContent}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconExact"></use></svg>
        </span>
    </div>
    <div class="b3-form__icon search__header">
        <div style="position: relative" class="fn__flex-1">
             <span class="search__history-icon ariaLabel" id="searchHistoryBtn" aria-label="${updateHotkeyTip("⌥↓")}">
                <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
                <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
            </span>
            <input id="searchInput" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.showRecentUpdatedBlocks}">
        </div>
        <div class="block__icons">
            <span id="searchFilter" aria-label="${window.siyuan.languages.searchType}" class="block__icon ariaLabel" data-position="9bottom">
                <svg><use xlink:href="#iconFilter"></use></svg>
            </span> 
            <span class="fn__space"></span>
            <span id="searchSyntaxCheck" aria-label="${window.siyuan.languages.searchMethod} ${methodText}" class="block__icon ariaLabel" data-position="9bottom">
                <svg><use xlink:href="#iconRegex"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchReplace" aria-label="${window.siyuan.languages.replace}" class="block__icon ariaLabel" data-position="9bottom">
                <svg><use xlink:href="#iconReplace"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon ariaLabel" data-position="9bottom">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </span>
            <div class="fn__flex${config.group === 0 ? " fn__none" : ""}">
                <span class="fn__space"></span>
                <span id="searchExpand" class="block__icon block__icon--show ariaLabel" data-position="9bottom" aria-label="${window.siyuan.languages.expand}">
                    <svg><use xlink:href="#iconExpand"></use></svg>
                </span>
                <span class="fn__space"></span>
                <span id="searchCollapse" class="block__icon block__icon--show ariaLabel" data-position="9bottom" aria-label="${window.siyuan.languages.collapse}">
                    <svg><use xlink:href="#iconContract"></use></svg>
                </span>
            </div>
        </div>
    </div>
    <div class="b3-form__icon search__header${config.hasReplace ? "" : " fn__none"}">
        <div class="fn__flex-1" style="position: relative">
            <span class="search__history-icon ariaLabel" id="replaceHistoryBtn" aria-label="${updateHotkeyTip("⌥↓")}">
                <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconReplace"></use></svg>
                <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
            </span>
            <input id="replaceInput" class="b3-text-field b3-text-field--text">
        </div>
        <div class="fn__space"></div>
        <svg class="fn__rotate fn__none svg" style="padding: 0 8px;align-self: center;margin-right: 8px"><use xlink:href="#iconRefresh"></use></svg>
        <span id="replaceFilter" aria-label="${window.siyuan.languages.replaceType}" class="block__icon ariaLabel fn__flex-center" data-position="9bottom">
            <svg><use xlink:href="#iconFilter"></use></svg>
        </span>
        <span class="fn__space"></span>
        <button id="replaceAllBtn" class="b3-button b3-button--small b3-button--outline fn__flex-center">${window.siyuan.languages.replaceAll}</button>
        <div class="fn__space"></div>
        <button id="replaceBtn" class="b3-button b3-button--small b3-button--outline fn__flex-center">↵ ${window.siyuan.languages.replace}</button>
        <div class="fn__space"></div>
    </div>
    <div id="criteria" class="search__header"></div>
    <div class="search__layout${(closeCB ? data.layout === 1 : data.layoutTab === 1) ? " search__layout--row" : ""}">
        <div id="searchList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
        <div class="search__drag"></div>
        <div id="searchPreview" class="fn__flex-1 search__preview"></div>
    </div>
    <div class="search__tip${closeCB ? "" : " fn__none"}">
        <kbd>↑/↓/PageUp/PageDown</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>${updateHotkeyTip(window.siyuan.config.keymap.general.newFile.custom)}</kbd> ${window.siyuan.languages.new}
        <kbd>${window.siyuan.languages.enterKey}/${window.siyuan.languages.doubleClick}</kbd> ${window.siyuan.languages.searchTip2}
        <kbd>${window.siyuan.languages.click}</kbd> ${window.siyuan.languages.searchTip3}
        <kbd>${updateHotkeyTip(window.siyuan.config.keymap.editor.general.insertRight.custom)}/${isMac() ? "⌥" : "Alt+"}${window.siyuan.languages.click}</kbd> ${window.siyuan.languages.searchTip4}
        <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
    </div>
</div>
<div class="fn__flex-column fn__none" id="searchAssets" style="height: 100%;${closeCB ? "border-radius: var(--b3-border-radius-b);overflow: hidden;" : ""}"></div>
<div class="fn__flex-column fn__none" id="searchUnRefPanel" style="height: 100%;${closeCB ? "border-radius: var(--b3-border-radius-b);overflow: hidden;" : ""}">
    <div class="block__icons">
        <span data-type="unRefPrevious" class="block__icon block__icon--show ariaLabel" data-position="9bottom" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="unRefNext" class="block__icon block__icon--show ariaLabel" data-position="9bottom" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span id="searchUnRefResult" class="ft__selectnone"></span>
        <span class="fn__flex-1"></span>
        <span class="fn__space"></span>
        <span id="unRefMore" aria-label="${window.siyuan.languages.more}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconMore"></use></svg>
        </span>
        <span class="fn__space"></span>
        <span id="searchUnRefClose" aria-label="${!closeCB ? window.siyuan.languages.stickSearch : window.siyuan.languages.globalSearch}" class="block__icon block__icon--show ariaLabel" data-position="9bottom">
            <svg><use xlink:href="#iconBack"></use></svg>
        </span>
    </div>
    <div class="search__layout${unRefLocal.layout === 1 ? " search__layout--row" : ""}">
        <div id="searchUnRefList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
        <div class="search__drag"></div>
        <div id="searchUnRefPreview" class="fn__flex-1 search__preview b3-typography" style="padding: 8px"></div>
    </div>
    <div class="search__tip${closeCB ? "" : " fn__none"}">
        <kbd>↑/↓/PageUp/PageDown</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>${window.siyuan.languages.enterKey}/${window.siyuan.languages.doubleClick}</kbd> ${window.siyuan.languages.searchTip2}
        <kbd>${updateHotkeyTip(window.siyuan.config.keymap.editor.general.insertRight.custom)}/${updateHotkeyTip("⌥" + window.siyuan.languages.click)}</kbd> ${window.siyuan.languages.searchTip4}
        <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
    </div>
</div>
<div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>`;

    const criteriaData: Config.IUILayoutTabSearchConfig[] = [];
    initCriteriaMenu(element.querySelector("#criteria"), criteriaData, config);
    const searchPanelElement = element.querySelector("#searchList");
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;

    const edit = new Protyle(app, element.querySelector("#searchPreview") as HTMLElement, {
        blockId: "",
        render: {
            gutter: true,
            breadcrumbDocName: true
        },
    });
    edit.resize();
    const unRefEdit = new Protyle(app, element.querySelector("#searchUnRefPreview") as HTMLElement, {
        blockId: "",
        render: {
            gutter: true,
            breadcrumbDocName: true
        },
    });
    unRefEdit.resize();
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
    let lastClickTime = new Date().getTime();

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
                resize(edit.protyle);
            }
        };
    });

    const localSearch = window.siyuan.storage[Constants.LOCAL_SEARCHASSET] as ISearchAssetOption;
    const assetsElement = element.querySelector("#searchAssets");
    const unRefPanelElement = element.querySelector("#searchUnRefPanel");
    element.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        const searchPathInputElement = element.querySelector("#searchPathInput");
        while (target && !target.isSameNode(element)) {
            const type = target.getAttribute("data-type");
            if (type === "removeCriterion") {
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
                    page: 1,
                    types: getDefaultType(),
                    replaceTypes: Object.assign({}, Constants.SIYUAN_DEFAULT_REPLACETYPES),
                }, config, edit, true);
                element.querySelector(".b3-chip--current")?.classList.remove("b3-chip--current");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "saveCriterion") {
                saveCriterion(config, criteriaData, element);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "next") {
                if (!target.getAttribute("disabled")) {
                    if (config.page < parseInt(target.parentElement.querySelector("#searchResult").getAttribute("data-pagecount"))) {
                        config.page++;
                        inputEvent(element, config, edit);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "previous") {
                if (!target.getAttribute("disabled")) {
                    if (config.page > 1) {
                        config.page--;
                        inputEvent(element, config, edit);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-chip") && type === "set-criteria") {
                config.removed = false;
                target.parentElement.querySelector(".b3-chip--current")?.classList.remove("b3-chip--current");
                target.classList.add("b3-chip--current");
                criteriaData.find(item => {
                    if (item.name === target.innerText.trim()) {
                        updateConfig(element, item, config, edit);
                        return true;
                    }
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-chip__close") && type === "remove-criteria") {
                const name = target.parentElement.textContent;
                fetchPost("/api/storage/removeCriterion", {name});
                criteriaData.find((item, index) => {
                    if (item.name === name) {
                        criteriaData.splice(index, 1);
                        return true;
                    }
                });
                target.parentElement.remove();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("search__rmpath")) {
                config.idPath = [];
                config.hPath = "";
                config.page = 1;
                searchPathInputElement.textContent = "";
                searchPathInputElement.setAttribute("aria-label", "");
                inputEvent(element, config, edit, true);
                const includeElement = element.querySelector("#searchInclude");
                includeElement.firstElementChild.classList.add("ft__primary");
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
                        config.page = 1;
                        searchPathInputElement.innerHTML = `${escapeGreat(config.hPath)}<svg class="search__rmpath"><use xlink:href="#iconCloseRound"></use></svg>`;
                        searchPathInputElement.setAttribute("aria-label", escapeHtml(config.hPath));
                        const includeElement = element.querySelector("#searchInclude");
                        includeElement.firstElementChild.classList.add("ft__primary");
                        if (enableIncludeChild) {
                            includeElement.removeAttribute("disabled");
                        } else {
                            includeElement.setAttribute("disabled", "disabled");
                        }
                        inputEvent(element, config, edit, true);
                    });
                }, [], undefined, window.siyuan.languages.specifyPath);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchInclude") {
                const svgElement = target.firstElementChild;
                svgElement.classList.toggle("ft__primary");
                if (!svgElement.classList.contains("ft__primary")) {
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
                config.page = 1;
                inputEvent(element, config, edit, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchReplace") {
                // ctrl+P 不需要保存
                config.hasReplace = !config.hasReplace;
                element.querySelectorAll(".search__header")[1].classList.toggle("fn__none");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchUnRef") {
                openSearchUnRef(unRefPanelElement, unRefEdit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "unRefMore") {
                unRefMoreMenu(target, unRefPanelElement, unRefEdit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchUnRefClose") {
                window.siyuan.menus.menu.remove();
                unRefPanelElement.classList.add("fn__none");
                assetsElement.previousElementSibling.classList.remove("fn__none");
                searchInputElement.select();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "unRefPrevious") {
                if (!target.getAttribute("disabled")) {
                    let currentPage = parseInt(unRefPanelElement.querySelector("#searchUnRefResult").textContent);
                    if (currentPage > 1) {
                        currentPage--;
                        getUnRefList(unRefPanelElement, unRefEdit, currentPage);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "unRefNext") {
                if (!target.getAttribute("disabled")) {
                    let currentPage = parseInt(unRefPanelElement.querySelector("#searchUnRefResult").textContent);
                    if (currentPage < parseInt(unRefPanelElement.querySelector("#searchUnRefResult").textContent.split("/")[1])) {
                        currentPage++;
                        getUnRefList(unRefPanelElement, unRefEdit, currentPage);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchAsset") {
                openSearchAsset(assetsElement, !closeCB);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchAssetClose") {
                window.siyuan.menus.menu.remove();
                assetsElement.classList.add("fn__none");
                assetsElement.previousElementSibling.classList.remove("fn__none");
                searchInputElement.select();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchOpen") {
                config.k = searchInputElement.value;
                config.r = replaceInputElement.value;
                openFile({
                    app,
                    searchData: config,
                    position: (window.siyuan.layout.centerLayout.children.length > 1 || window.innerWidth > 1024) ? "right" : undefined
                });
                if (closeCB) {
                    closeCB();
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchRefresh") {
                inputEvent(element, config, edit);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchMore") {
                moreMenu(config, criteriaData, element, () => {
                    config.page = 1;
                    inputEvent(element, config, edit, true);
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
                        page: 1,
                        types: getDefaultType(),
                        replaceTypes: Object.assign({}, Constants.SIYUAN_DEFAULT_REPLACETYPES),
                    }, config, edit, true);
                    element.querySelector("#criteria .b3-chip--current")?.classList.remove("b3-chip--current");
                }, () => {
                    const localData = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
                    const isPopover = hasClosestByClassName(element, "b3-dialog__container");
                    window.siyuan.menus.menu.append(new MenuItem({
                        iconHTML: "",
                        label: window.siyuan.languages.layout,
                        type: "submenu",
                        submenu: [{
                            iconHTML: "",
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
                                resize(edit.protyle);
                                if (isPopover) {
                                    localData.layout = 0;
                                } else {
                                    localData.layoutTab = 0;
                                }
                                setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            }
                        }, {
                            iconHTML: "",
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
                                resize(edit.protyle);
                                if (isPopover) {
                                    localData.layout = 1;
                                } else {
                                    localData.layoutTab = 1;
                                }
                                setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            }
                        }]
                    }).element);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom, isLeft: true});
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchFilter") {
                window.siyuan.menus.menu.remove();
                filterMenu(config, () => {
                    config.page = 1;
                    inputEvent(element, config, edit, true);
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "replaceFilter") {
                window.siyuan.menus.menu.remove();
                replaceFilterMenu(config);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "assetPrevious") {
                if (!target.getAttribute("disabled")) {
                    let currentPage = parseInt(assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/")[0]);
                    if (currentPage > 1) {
                        currentPage--;
                        assetInputEvent(assetsElement, localSearch, currentPage);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "assetNext") {
                if (!target.getAttribute("disabled")) {
                    let currentPage = parseInt(assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/")[0]);
                    if (currentPage < parseInt(assetsElement.querySelector("#searchAssetResult .fn__flex-center").textContent.split("/")[1])) {
                        currentPage++;
                        assetInputEvent(assetsElement, localSearch, currentPage);
                    }
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "assetMore") {
                assetMoreMenu(target, assetsElement, () => {
                    assetInputEvent(assetsElement);
                    setStorageVal(Constants.LOCAL_SEARCHASSET, localSearch);
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "assetFilter") {
                assetFilterMenu(assetsElement);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "assetSyntaxCheck") {
                assetMethodMenu(target, () => {
                    element.querySelector("#assetSyntaxCheck").setAttribute("aria-label", getQueryTip(localSearch.method));
                    assetInputEvent(assetsElement, localSearch);
                    setStorageVal(Constants.LOCAL_SEARCHASSET, localSearch);
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchSyntaxCheck") {
                queryMenu(config, () => {
                    element.querySelector("#searchSyntaxCheck").setAttribute("aria-label", getQueryTip(config.method));
                    config.page = 1;
                    inputEvent(element, config, edit, true);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom, isLeft: true});
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchHistoryBtn") {
                toggleSearchHistory(element, config, edit);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "assetHistoryBtn") {
                toggleAssetHistory(assetsElement);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceHistoryBtn") {
                toggleReplaceHistory(element);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceAllBtn") {
                replace(element, config, edit, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "assetRefresh") {
                assetInputEvent(assetsElement);
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
                const searchAssetInputElement = element.querySelector("#searchAssetInput") as HTMLInputElement;
                if (type === "search-new") {
                    if (config.method == 0) {
                        newFileByName(app, searchInputElement.value);
                    }
                } else if (type === "search-item") {
                    const searchType = target.dataset.id ? "asset" : (unRefPanelElement.classList.contains("fn__none") ? "doc" : "unRef");
                    let isClick = event.detail === 1;
                    let isDblClick = event.detail === 2;
                    /// #if BROWSER
                    const newDate = new Date().getTime();
                    isClick = newDate - lastClickTime > Constants.TIMEOUT_DBLCLICK;
                    isDblClick = !isClick;
                    lastClickTime = newDate;
                    /// #endif
                    if (isClick) {
                        clickTimeout = window.setTimeout(() => {
                            if (searchType === "asset") {
                                if (!target.classList.contains("b3-list-item--focus")) {
                                    assetsElement.querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                                    target.classList.add("b3-list-item--focus");
                                    renderPreview(element.querySelector("#searchAssetPreview"), target.dataset.id, searchAssetInputElement.value, window.siyuan.storage[Constants.LOCAL_SEARCHASSET].method);
                                    searchAssetInputElement.focus();
                                } else if (target.classList.contains("b3-list-item--focus")) {
                                    renderNextAssetMark(element.querySelector("#searchAssetPreview"));
                                    searchAssetInputElement.focus();
                                }
                            } else {
                                if (event.altKey) {
                                    const id = target.getAttribute("data-node-id");
                                    checkFold(id, (zoomIn, action) => {
                                        openFileById({
                                            app,
                                            id,
                                            action,
                                            zoomIn,
                                            position: "right"
                                        });
                                        if (closeCB) {
                                            closeCB();
                                        }
                                    });
                                } else if (!target.classList.contains("b3-list-item--focus")) {
                                    (searchType === "doc" ? searchPanelElement : unRefPanelElement).querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                                    target.classList.add("b3-list-item--focus");
                                    getArticle({
                                        edit: searchType === "doc" ? edit : unRefEdit,
                                        id: target.getAttribute("data-node-id"),
                                        config: searchType === "doc" ? config : null,
                                        value: searchType === "doc" ? searchInputElement.value : null,
                                    });
                                    searchInputElement.focus();
                                } else if (searchType === "doc" && target.classList.contains("b3-list-item--focus")) {
                                    renderNextSearchMark({
                                        edit,
                                        id: target.getAttribute("data-node-id"),
                                        target,
                                    });
                                    searchInputElement.focus();
                                }
                            }
                        }, Constants.TIMEOUT_DBLCLICK);
                    } else if (isDblClick && isNotCtrl(event)) {
                        clearTimeout(clickTimeout);
                        if (searchType === "asset") {
                            /// #if !BROWSER
                            showFileInFolder(path.join(window.siyuan.config.system.dataDir, target.lastElementChild.getAttribute("aria-label")));
                            /// #endif
                        } else {
                            const id = target.getAttribute("data-node-id");
                            checkFold(id, (zoomIn, action) => {
                                openFileById({
                                    app,
                                    id,
                                    action,
                                    zoomIn
                                });
                                if (closeCB) {
                                    closeCB();
                                }
                            });
                        }
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
    }, false);

    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        config.page = 1;
        if (event.isComposing) {
            return;
        }
        inputEvent(element, config, edit, true);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        config.page = 1;
        if (event.isComposing) {
            return;
        }
        inputEvent(element, config, edit, true);
    });
    searchInputElement.addEventListener("blur", () => {
        if (config.removed) {
            config.k = searchInputElement.value;
            window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
            setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
        }
        saveKeyList("keys", searchInputElement.value);
    });
    addClearButton({
        inputElement: searchInputElement,
        right: 8,
        height: searchInputElement.clientHeight,
        clearCB() {
            config.page = 1;
            inputEvent(element, config, edit);
        }
    });
    addClearButton({
        right: 8,
        inputElement: replaceInputElement,
        height: searchInputElement.clientHeight,
    });
    inputEvent(element, config, edit);
    return {edit, unRefEdit};
};

export const getQueryTip = (method: number) => {
    let methodTip = window.siyuan.languages.searchMethod + " ";
    switch (method) {
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
    return methodTip;
};

export const updateConfig = (element: Element, item: Config.IUILayoutTabSearchConfig, config: Config.IUILayoutTabSearchConfig,
                      edit: Protyle, clear = false) => {
    const dialogElement = hasClosestByClassName(element, "b3-dialog--open");
    if (dialogElement && dialogElement.getAttribute("data-key") === Constants.DIALOG_SEARCH) {
        // https://github.com/siyuan-note/siyuan/issues/6828
        item.hPath = config.hPath;
        item.idPath = config.idPath.join(",").split(",");
    }
    if (config.hasReplace !== item.hasReplace) {
        const replaceHeaderElement = element.querySelectorAll(".search__header")[1];
        if (item.hasReplace) {
            replaceHeaderElement.classList.remove("fn__none");
        } else {
            replaceHeaderElement.classList.add("fn__none");
        }
    }
    const searchPathInputElement = element.querySelector("#searchPathInput");
    if (item.hPath) {
        searchPathInputElement.innerHTML = `${escapeGreat(item.hPath)}<svg class="search__rmpath"><use xlink:href="#iconCloseRound"></use></svg>`;
        searchPathInputElement.setAttribute("aria-label", escapeHtml(item.hPath));
    } else {
        searchPathInputElement.innerHTML = "";
        searchPathInputElement.setAttribute("aria-label", "");
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
        searchIncludeElement.firstElementChild.classList.add("ft__primary");
    } else {
        searchIncludeElement.firstElementChild.classList.remove("ft__primary");
    }
    if (enableIncludeChild) {
        searchIncludeElement.removeAttribute("disabled");
    } else {
        searchIncludeElement.setAttribute("disabled", "disabled");
    }
    if (item.k || clear) {
        (element.querySelector("#searchInput") as HTMLInputElement).value = item.k;
    }
    (element.querySelector("#replaceInput") as HTMLInputElement).value = item.r;
    element.querySelector("#searchSyntaxCheck").setAttribute("aria-label", getQueryTip(item.method));
    Object.assign(config, item);
    window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
    setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
    inputEvent(element, config, edit);
    window.siyuan.menus.menu.remove();
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

export const getArticle = (options: {
    id: string,
    config?: Config.IUILayoutTabSearchConfig,
    edit: Protyle
    value?: string,
}) => {
    checkFold(options.id, (zoomIn) => {
        options.edit.protyle.scroll.lastScrollTop = 0;
        addLoading(options.edit.protyle);
        fetchPost("/api/block/getDocInfo", {
            id: options.id,
        }, (response) => {
            options.edit.protyle.wysiwyg.renderCustom(response.data.ial);
            fetchPost("/api/filetree/getDoc", {
                id: options.id,
                query: options.value || null,
                queryMethod: options.config?.method || null,
                queryTypes: options.config?.types || null,
                mode: zoomIn ? 0 : 3,
                size: zoomIn ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
                zoom: zoomIn,
            }, getResponse => {
                options.edit.protyle.query = {
                    key: options.value || null,
                    method: options.config?.method || null,
                    types: options.config?.types || null,
                };
                onGet({
                    updateReadonly: true,
                    data: getResponse,
                    protyle: options.edit.protyle,
                    action: zoomIn ? [Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_HL, Constants.CB_GET_HTML],
                });
                const matchElement = options.edit.protyle.wysiwyg.element.querySelector(`div[data-node-id="${options.id}"] span[data-type~="search-mark"]`);
                if (matchElement) {
                    matchElement.classList.add("search-mark--hl");
                    const contentRect = options.edit.protyle.contentElement.getBoundingClientRect();
                    const matchRectTop = matchElement.getBoundingClientRect().top;  // 需前置，否则代码高亮后会移除该元素
                    setTimeout(() => {
                        // 等待 scrollCenter 定位后再滚动
                        options.edit.protyle.contentElement.scrollTop = options.edit.protyle.contentElement.scrollTop + matchRectTop - contentRect.top - contentRect.height / 2;
                    });
                }
            });
        });
    });
};

export const replace = (element: Element, config: Config.IUILayoutTabSearchConfig, edit: Protyle, isAll: boolean) => {
    if (config.method === 1 || config.method === 2) {
        showMessage(window.siyuan.languages._kernel[132]);
        return;
    }
    const searchPanelElement = element.querySelector("#searchList");
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;

    const loadElement = element.querySelector("svg.fn__rotate");
    if (!loadElement.classList.contains("fn__none")) {
        return;
    }
    saveKeyList("replaceKeys", replaceInputElement.value);
    let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
    if (!currentList || currentList.dataset.type === "search-new") {
        return;
    }
    loadElement.classList.remove("fn__none");
    fetchPost("/api/search/findReplace", {
        k: config.method === 0 ? getKeyByLiElement(currentList) : searchInputElement.value,
        r: replaceInputElement.value,
        method: config.method,
        types: config.types,
        paths: config.idPath || [],
        groupBy: config.group,
        orderBy: config.sort,
        page: config.page,
        ids: isAll ? [] : [currentList.getAttribute("data-node-id")],
        replaceTypes: config.replaceTypes
    }, (response) => {
        loadElement.classList.add("fn__none");
        if (response.code === 1) {
            showMessage(response.msg);
            return;
        }
        if (isAll) {
            return;
        }
        const rootId = currentList.getAttribute("data-root-id");
        getAllModels().editor.forEach(item => {
            if (rootId === item.editor.protyle.block.rootID) {
                reloadProtyle(item.editor.protyle, false);
            }
        });
        if (currentList.nextElementSibling) {
            currentList.nextElementSibling.classList.add("b3-list-item--focus");
        } else if (currentList.previousElementSibling) {
            currentList.previousElementSibling.classList.add("b3-list-item--focus");
        }
        if (config.group === 1) {
            if (currentList.nextElementSibling || currentList.previousElementSibling) {
                currentList.remove();
            } else {
                const nextDocElement = currentList.parentElement.nextElementSibling || currentList.parentElement.previousElementSibling.previousElementSibling?.previousElementSibling;
                if (nextDocElement) {
                    nextDocElement.nextElementSibling.firstElementChild.classList.add("b3-list-item--focus");
                    nextDocElement.nextElementSibling.classList.remove("fn__none");
                    nextDocElement.firstElementChild.firstElementChild.classList.add("b3-list-item__arrow--open");
                }
                currentList.parentElement.previousElementSibling.remove();
                currentList.parentElement.remove();
            }
        } else {
            currentList.remove();
        }
        currentList = searchPanelElement.querySelector(".b3-list-item--focus");
        if (!currentList) {
            searchPanelElement.innerHTML = `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
            edit.protyle.element.classList.add("fn__none");
            element.querySelector(".search__drag").classList.add("fn__none");
            return;
        }
        if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + 30 ||
            searchPanelElement.scrollTop > currentList.offsetTop) {
            searchPanelElement.scrollTop = currentList.offsetTop - searchPanelElement.clientHeight + 30;
        }
        getArticle({
            edit,
            id: currentList.getAttribute("data-node-id"),
            config,
            value: searchInputElement.value,
        });
    });
};

export const inputEvent = (element: Element, config: Config.IUILayoutTabSearchConfig, edit: Protyle, rmCurrentCriteria = false) => {
    let inputTimeout = parseInt(element.getAttribute("data-timeout") || "0");
    clearTimeout(inputTimeout);
    inputTimeout = window.setTimeout(() => {
        if (rmCurrentCriteria) {
            element.querySelector("#criteria .b3-chip--current")?.classList.remove("b3-chip--current");
        }
        const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
        const loadingElement = element.querySelector(".fn__loading--top");
        loadingElement.classList.remove("fn__none");
        const inputValue = searchInputElement.value;
        element.querySelector("#searchList").scrollTo(0, 0);
        const previousElement = element.querySelector('[data-type="previous"]');
        const nextElement = element.querySelector('[data-type="next"]');
        edit.protyle?.app.plugins.forEach(item => {
            item.eventBus.emit("input-search", {
                protyle: edit,
                config,
                searchElement: searchInputElement,
            });
        });
        const searchResultElement = element.querySelector("#searchResult");
        if (inputValue === "" && (!config.idPath || config.idPath.length === 0)) {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onSearch(response.data, edit, element, config);
                loadingElement.classList.add("fn__none");
                searchResultElement.innerHTML = "";
                previousElement.setAttribute("disabled", "true");
                nextElement.setAttribute("disabled", "true");
            });
        } else {
            if (config.page > 1) {
                previousElement.removeAttribute("disabled");
            } else {
                previousElement.setAttribute("disabled", "disabled");
            }
            fetchPost("/api/search/fullTextSearchBlock", {
                query: inputValue,
                method: config.method,
                types: config.types,
                paths: config.idPath || [],
                groupBy: config.group,
                orderBy: config.sort,
                page: config.page || 1,
            }, (response) => {
                if (!config.page) {
                    config.page = 1;
                }
                if (config.page < response.data.pageCount) {
                    nextElement.removeAttribute("disabled");
                } else {
                    nextElement.setAttribute("disabled", "disabled");
                }
                onSearch(response.data.blocks, edit, element, config);
                searchResultElement.innerHTML = `${config.page}/${response.data.pageCount || 1}<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.findInDoc.replace("${x}", response.data.matchedRootCount).replace("${y}", response.data.matchedBlockCount)}</span>`;
                loadingElement.classList.add("fn__none");
                searchResultElement.setAttribute("data-pagecount", response.data.pageCount || 1);
            });
        }
    }, Constants.TIMEOUT_INPUT);
    element.setAttribute("data-timeout", inputTimeout.toString());
};

export const getAttr = (block: IBlock) => {
    let attrHTML = "";
    if (block.name) {
        attrHTML += `<span class="b3-list-item__meta fn__flex" style="max-width: 30%"><svg class="b3-list-item__hinticon"><use xlink:href="#iconN"></use></svg><span class="b3-list-item__hinttext">${block.name}</span></span>`;
    }
    if (block.alias) {
        attrHTML += `<span class="b3-list-item__meta fn__flex" style="max-width: 30%"><svg class="b3-list-item__hinticon"><use xlink:href="#iconA"></use></svg><span class="b3-list-item__hinttext">${block.alias}</span></span>`;
    }
    if (block.memo) {
        attrHTML += `<span class="b3-list-item__meta fn__flex" style="max-width: 30%"><svg class="b3-list-item__hinticon"><use xlink:href="#iconM"></use></svg><span class="b3-list-item__hinttext">${block.memo}</span></span>`;
    }
    return attrHTML;
};

const onSearch = (data: IBlock[], edit: Protyle, element: Element, config: Config.IUILayoutTabSearchConfig) => {
    let resultHTML = "";
    data.forEach((item, index) => {
        const title = getNotebookName(item.box) + getDisplayName(item.hPath, false);
        if (item.children) {
            resultHTML += `<div class="b3-list-item">
<span class="b3-list-item__toggle b3-list-item__toggle--hl">
    <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
</span>
${unicode2Emoji(getNotebookIcon(item.box) || Constants.SIYUAN_IMAGE_NOTE, "b3-list-item__graphic", true)}
<span class="b3-list-item__text ariaLabel" style="color: var(--b3-theme-on-surface)" aria-label="${escapeAriaLabel(title)}">${escapeGreat(title)}</span>
</div><div>`;
            item.children.forEach((childItem, childIndex) => {
                resultHTML += `<div style="padding-left: 36px" data-type="search-item" class="b3-list-item${childIndex === 0 && index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${childItem.id}" data-root-id="${childItem.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(childItem.type)}"></use></svg>
${unicode2Emoji(childItem.ial.icon, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${childItem.content}</span>
${getAttr(childItem)}
</div>`;
            });
            resultHTML += "</div>";
        } else {
            resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${item.id}" data-root-id="${item.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
${unicode2Emoji(item.ial.icon, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${item.content}</span>
${getAttr(item)}
<span class="b3-list-item__meta b3-list-item__meta--ellipsis ariaLabel" aria-label="${escapeAriaLabel(title)}">${escapeGreat(title)}</span>
</div>`;
        }
    });

    if (data[0]) {
        edit.protyle.element.classList.remove("fn__none");
        element.querySelector(".search__drag").classList.remove("fn__none");
        const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
        if (data[0].children) {
            getArticle({
                edit,
                id: data[0].children[0].id,
                config,
                value: searchInputElement.value,
            });
        } else {
            getArticle({
                edit,
                id: data[0].id,
                config,
                value: searchInputElement.value,
            });
        }
    } else {
        edit.protyle.element.classList.add("fn__none");
        element.querySelector(".search__drag").classList.add("fn__none");
    }
    element.querySelector("#searchList").innerHTML = resultHTML || (
        config.method === 0 ? `<div class="b3-list-item b3-list-item--focus" data-type="search-new">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
    <span class="b3-list-item__text">
        ${window.siyuan.languages.newFile} <mark>${(element.querySelector("#searchInput") as HTMLInputElement).value}</mark>
    </span>
    <kbd class="b3-list-item__meta">${window.siyuan.languages.enterNew}</kbd>
</div>
<div class="search__empty">
    ${window.siyuan.languages.enterNewTip}
</div>` : `<div class="b3-list-item b3-list-item--focus" data-type="search-new">
    <span class="b3-list-item__text">
        ${window.siyuan.languages.emptyContent}
    </span>
</div>`);
};
