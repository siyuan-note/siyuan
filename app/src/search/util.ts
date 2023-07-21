import {getAllModels} from "../layout/getAll";
import {Constants} from "../constants";
import {escapeAttr, escapeGreat, escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {openFile, openFileById} from "../editor/util";
import {showMessage} from "../dialog/message";
import {reloadProtyle} from "../protyle/util/reload";
import {MenuItem} from "../menus/Menu";
import {getDisplayName, getNotebookIcon, getNotebookName, movePathTo, pathPosix} from "../util/pathName";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {addLoading, setPadding} from "../protyle/ui/initUI";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {setStorageVal, updateHotkeyTip} from "../protyle/util/compatibility";
import {newFileByName} from "../util/newFile";
import {matchHotKey} from "../protyle/util/hotKey";
import {filterMenu, getKeyByLiElement, initCriteriaMenu, moreMenu, queryMenu, saveCriterion} from "./menu";
import {App} from "../index";
import {upDownHint} from "../util/upDownHint";

const toggleReplaceHistory = (replaceHistoryElement: Element, historyElement: Element, replaceInputElement: HTMLInputElement) => {
    if (replaceHistoryElement.classList.contains("fn__none")) {
        const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
        if (!list.replaceKeys || list.replaceKeys.length === 0) {
            return;
        }
        let html = "";
        list.replaceKeys.forEach((s: string) => {
            if (s !== replaceInputElement.value && s) {
                html += `<div class="b3-list-item${html ? "" : " b3-list-item--focus"}">${escapeHtml(s)}</div>`;
            }
        });
        if (html === "") {
            return;
        }
        replaceHistoryElement.classList.remove("fn__none");
        replaceHistoryElement.innerHTML = html;
    } else {
        replaceHistoryElement.classList.add("fn__none");
    }
    historyElement.classList.add("fn__none");
};

const toggleSearchHistory = (historyElement: Element, replaceHistoryElement: Element, searchInputElement: HTMLInputElement) => {
    if (historyElement.classList.contains("fn__none")) {
        const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
        if (!list.keys || list.keys.length === 0) {
            return;
        }
        let html = "";
        list.keys.forEach((s: string) => {
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
    replaceHistoryElement.classList.add("fn__none");
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
            removed: localData.removed,
            page: 1
        },
        position: "right"
    });
};

// closeCB 不存在为页签搜索
export const genSearch = (app: App, config: ISearchOption, element: Element, closeCB?: () => void) => {
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
    element.innerHTML = `<div class="fn__flex-column" style="height: 100%;${closeCB ? "border-radius: var(--b3-border-radius-b);overflow: hidden;" : ""}">
    <div class="b3-form__icon search__header">
        <span class="fn__a" id="searchHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="searchInput" style="padding-right: 60px" class="b3-text-field b3-text-field--text" placeholder="${window.siyuan.languages.showRecentUpdatedBlocks}">
        <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
        <div class="block__icons">
            <span id="searchRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </span>
            <span class="fn__space"></span>
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
            <span class="${closeCB ? "" : "fn__none "}fn__space"></span>
            <span id="searchOpen" aria-label="${window.siyuan.languages.openInNewTab}" class="${closeCB ? "" : "fn__none "}block__icon b3-tooltips b3-tooltips__w">
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
        <button id="replaceBtn" class="b3-button b3-button--small b3-button--outline fn__flex-center">↵ ${window.siyuan.languages.replace}</button>
        <div class="fn__space"></div>
        <div id="replaceHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    </div>
    <div id="criteria" class="fn__flex" style="min-height:40px;background-color: var(--b3-theme-background)"></div>
    <div class="block__icons">
        <span data-type="previous" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon block__icon--show b3-tooltips b3-tooltips__ne" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
        <span class="fn__space"></span>
        <span id="searchResult"></span>
        <span class="fn__space"></span>
        <span class="fn__flex-1"></span>
        <span id="searchPathInput" class="search__path ft__on-surface fn__flex-center ft__smaller fn__ellipsis" title="${escapeAttr(config.hPath)}">
            ${escapeHtml(config.hPath)}
            <svg class="search__rmpath${config.hPath ? "" : " fn__none"}"><use xlink:href="#iconCloseRound"></use></svg>
        </span>
        <span class="fn__space"></span>
        <button ${enableIncludeChild ? "" : "disabled"} id="searchInclude" class="b3-button b3-button--mid${includeChild ? "" : " b3-button--cancel"}">${window.siyuan.languages.includeChildDoc}</button>
        <span class="fn__space"></span>
        <span id="searchPath" aria-label="${window.siyuan.languages.specifyPath}" class="block__icon block__icon--show b3-tooltips b3-tooltips__w">
            <svg><use xlink:href="#iconFolder"></use></svg>
        </span>
        <div class="fn__flex${config.group === 0 ? " fn__none" : ""}">
            <span class="fn__space"></span>
            <span id="searchExpand" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.expand}">
                <svg><use xlink:href="#iconExpand"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchCollapse" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.collapse}">
                <svg><use xlink:href="#iconContract"></use></svg>
            </span>
        </div>
    </div>
    <div class="search__layout${(closeCB ? data.layout === 1 : data.layoutTab === 1) ? " search__layout--row" : ""}">
        <div id="searchList" class="fn__flex-1 search__list b3-list b3-list--background"></div>
        <div class="search__drag"></div>
        <div id="searchPreview" class="fn__flex-1 search__preview"></div>
    </div>
    <div class="search__tip">
        <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>${updateHotkeyTip(window.siyuan.config.keymap.general.newFile.custom)}</kbd> ${window.siyuan.languages.new}
        <kbd>Enter/Double Click</kbd> ${window.siyuan.languages.searchTip2}
        <kbd>Click</kbd> ${window.siyuan.languages.searchTip3}
        <kbd>${updateHotkeyTip(window.siyuan.config.keymap.editor.general.insertRight.custom)}/${updateHotkeyTip("⌥Click")}</kbd> ${window.siyuan.languages.searchTip4}
        <kbd>Esc</kbd> ${window.siyuan.languages.searchTip5}
    </div>
</div>
<div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>`;

    const criteriaData: ISearchOption[] = [];
    initCriteriaMenu(element.querySelector("#criteria"), criteriaData);
    const searchPanelElement = element.querySelector("#searchList");
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;
    const replaceHistoryElement = element.querySelector("#replaceHistoryList");
    const historyElement = element.querySelector("#searchHistoryList");

    const lineHeight = 30;
    const edit = new Protyle(app, element.querySelector("#searchPreview") as HTMLElement, {
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
                    config.page++;
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "previous") {
                if (!target.getAttribute("disabled")) {
                    config.page--;
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.classList.contains("b3-chip") && type === "set-criteria") {
                config.removed = false;
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
                const name = target.parentElement.innerText.trim();
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
                        config.page = 1;
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
                config.page = 1;
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
                config.k = searchInputElement.value;
                config.r = replaceInputElement.value;
                openFile({app, searchData: config, position: "right"});
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
                moreMenu(config, criteriaData, element, () => {
                    config.page = 1;
                    inputEvent(element, config, undefined, edit);
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
                }, () => {
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
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchFilter") {
                filterMenu(config, () => {
                    config.page = 1;
                    inputEvent(element, config, undefined, edit);
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchSyntaxCheck") {
                queryMenu(config, () => {
                    element.querySelector("#searchSyntaxCheck").setAttribute("aria-label", getQueryTip(config.method));
                    config.page = 1;
                    inputEvent(element, config, undefined, edit);
                });
                const rect = target.getBoundingClientRect();
                window.siyuan.menus.menu.popup({x: rect.right, y: rect.bottom}, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchHistoryBtn") {
                toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceHistoryBtn") {
                toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
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
                    config.page = 1;
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                } else if (target.parentElement.id === "replaceHistoryList") {
                    replaceInputElement.value = target.textContent;
                    replaceHistoryElement.classList.add("fn__none");
                } else if (type === "search-new") {
                    newFileByName(app, searchInputElement.value);
                } else if (type === "search-item") {
                    if (event.detail === 1) {
                        clickTimeout = window.setTimeout(() => {
                            if (event.altKey) {
                                const id = target.getAttribute("data-node-id");
                                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                                    openFileById({
                                        app,
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
                                    config,
                                    value: searchInputElement.value,
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
                                app,
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
        config.page = 1;
        inputTimeout = inputEvent(element, config, inputTimeout, edit, event);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        config.page = 1;
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
        if (searchInputElement.value && matchHotKey(window.siyuan.config.keymap.editor.general.insertRight.custom, event)) {
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                openFileById({
                    app,
                    id,
                    position: "right",
                    action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    zoomIn: foldResponse.data
                });
                if (closeCB) {
                    closeCB();
                }
            });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (searchInputElement.value && matchHotKey(window.siyuan.config.keymap.general.newFile.custom, event)) {
            newFileByName(app, searchInputElement.value);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const focusIsNew = currentList.getAttribute("data-type") === "search-new";
        const isHistory = !historyElement.classList.contains("fn__none");
        if (event.key === "Enter") {
            if (!isHistory) {
                if (focusIsNew) {
                    newFileByName(app, searchInputElement.value);
                } else {
                    const id = currentList.getAttribute("data-node-id");
                    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                        openFileById({
                            app,
                            id,
                            action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                            zoomIn: foldResponse.data
                        });
                        if (closeCB) {
                            closeCB();
                        }
                    });
                }
            } else {
                searchInputElement.value = historyElement.querySelector(".b3-list-item--focus").textContent.trim();
                config.page = 1;
                inputTimeout = inputEvent(element, config, inputTimeout, edit);
                toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
            }
            event.preventDefault();
        }
        if (event.key === "ArrowDown" && event.altKey) {
            toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
            return;
        }
        if (isHistory) {
            if (event.key === "Escape") {
                toggleSearchHistory(historyElement, replaceHistoryElement, searchInputElement);
            } else {
                upDownHint(historyElement, event);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (focusIsNew && !isHistory) {
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
                config,
                value: searchInputElement.value,
                edit,
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
                config,
                value: searchInputElement.value,
                edit,
            });
            event.preventDefault();
        }
    });
    replaceInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        const isHistory = !replaceHistoryElement.classList.contains("fn__none");
        if (event.key === "Enter") {
            if (isHistory) {
                replaceInputElement.value = replaceHistoryElement.querySelector(".b3-list-item--focus").textContent.trim();
                toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
            } else {
                replace(element, config, edit, false);
            }
            event.preventDefault();
        }
        if (event.key === "ArrowDown" && event.altKey) {
            toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
            return;
        }
        if (isHistory) {
            if (event.key === "Escape") {
                toggleReplaceHistory(replaceHistoryElement, historyElement, replaceInputElement);
            } else {
                upDownHint(replaceHistoryElement, event);
            }
            event.stopPropagation();
            event.preventDefault();
            return;
        }
    });
    inputTimeout = inputEvent(element, config, inputTimeout, edit);
    return edit;
};

const getQueryTip = (method: number) => {
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
    const searchPathInputElement = element.querySelector("#searchPathInput");
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
    element.querySelector("#searchSyntaxCheck").setAttribute("aria-label", getQueryTip(item.method));
    Object.assign(config, item);
    window.siyuan.storage[Constants.LOCAL_SEARCHDATA] = Object.assign({}, config);
    setStorageVal(Constants.LOCAL_SEARCHDATA, window.siyuan.storage[Constants.LOCAL_SEARCHDATA]);
    inputEvent(element, config, undefined, edit);
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

const getArticle = (options: {
    id: string,
    config: ISearchOption,
    edit: Protyle
    value: string,
}) => {
    fetchPost("/api/block/checkBlockFold", {id: options.id}, (foldResponse) => {
        options.edit.protyle.scroll.lastScrollTop = 0;
        addLoading(options.edit.protyle);
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            query: options.value,
            queryMethod: options.config.method,
            queryTypes: options.config.types,
            mode: foldResponse.data ? 0 : 3,
            size: foldResponse.data ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
            zoom: foldResponse.data,
        }, getResponse => {
            onGet({
                data: getResponse,
                protyle: options.edit.protyle,
                action: foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_HL, Constants.CB_GET_HTML],
            });
            const matchElement = options.edit.protyle.wysiwyg.element.querySelector(`div[data-node-id="${options.id}"] span[data-type~="search-mark"]`);
            if (matchElement) {
                matchElement.classList.add("search-mark--hl");
                const contentRect = options.edit.protyle.contentElement.getBoundingClientRect();
                options.edit.protyle.contentElement.scrollTop = options.edit.protyle.contentElement.scrollTop + matchElement.getBoundingClientRect().top - contentRect.top - contentRect.height / 2;
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
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;

    const loadElement = replaceInputElement.nextElementSibling;
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
        ids: isAll ? [] : [currentList.getAttribute("data-node-id")]
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
        const previousElement = element.querySelector('[data-type="previous"]');
        const nextElement = element.querySelector('[data-type="next"]');
        edit.protyle?.app.plugins.forEach(item => {
            item.eventBus.emit("input-search", {
                protyle: edit,
                config,
                searchElement: searchInputElement,
            });
        });
        if (inputValue === "" && (!config.idPath || config.idPath.length === 0)) {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onSearch(response.data, edit, element, config);
                loadingElement.classList.add("fn__none");
                element.querySelector("#searchResult").innerHTML = "";
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
                element.querySelector("#searchResult").innerHTML = `${config.page}/${response.data.pageCount || 1}<span class="fn__space"></span>
<span class="ft__on-surface">${window.siyuan.languages.findInDoc.replace("${x}", response.data.matchedRootCount).replace("${y}", response.data.matchedBlockCount)}</span>`;
                loadingElement.classList.add("fn__none");
            });
        }
    }, Constants.TIMEOUT_INPUT);
    return inputTimeout;
};

const onSearch = (data: IBlock[], edit: Protyle, element: Element, config: ISearchOption) => {
    let resultHTML = "";
    data.forEach((item, index) => {
        const title = getNotebookName(item.box) + getDisplayName(item.hPath, false);
        if (item.children) {
            resultHTML += `<div class="b3-list-item">
<span class="b3-list-item__toggle b3-list-item__toggle--hl">
    <svg class="b3-list-item__arrow b3-list-item__arrow--open"><use xlink:href="#iconRight"></use></svg>
</span>
${unicode2Emoji(getNotebookIcon(item.box) || Constants.SIYUAN_IMAGE_NOTE, "b3-list-item__graphic", true)}
<span class="b3-list-item__text" style="color: var(--b3-theme-on-surface)" title="${escapeAttr(title)}">${escapeGreat(title)}</span>
</div><div>`;
            item.children.forEach((childItem, childIndex) => {
                resultHTML += `<div style="padding-left: 36px" data-type="search-item" class="b3-list-item${childIndex === 0 && index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${childItem.id}" data-root-id="${childItem.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(childItem.type)}"></use></svg>
${unicode2Emoji(childItem.ial.icon, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${childItem.content}</span>
</div>`;
            });
            resultHTML += "</div>";
        } else {
            resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${item.id}" data-root-id="${item.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
${unicode2Emoji(item.ial.icon, "b3-list-item__graphic", true)}
<span class="b3-list-item__text">${item.content}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis" title="${escapeAttr(title)}">${escapeGreat(title)}</span>
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
    element.querySelector("#searchList").innerHTML = resultHTML ||
        `<div class="b3-list-item b3-list-item--focus" data-type="search-new">
    <svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
    <span class="b3-list-item__text">
        ${window.siyuan.languages.newFile} <mark>${(element.querySelector("#searchInput") as HTMLInputElement).value}</mark>
    </span>
    <kbd class="b3-list-item__meta">${window.siyuan.languages.enterNew}</kbd>
</div>
<div class="search__empty">
    ${window.siyuan.languages.enterNewTip}
</div>`;
};
