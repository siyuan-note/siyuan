import {getAllModels} from "../layout/getAll";
import {getWndByLayout, resizeTabs} from "../layout/util";
import {Tab} from "../layout/Tab";
import {Search} from "./index";
import {Wnd} from "../layout/Wnd";
import {Constants} from "../constants";
import {escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {showMessage} from "../dialog/message";
import {reloadProtyle} from "../protyle/util/reload";
import {MenuItem} from "../menus/Menu";
import {getDisplayName, getNotebookName, movePathTo} from "../util/pathName";
import {Protyle} from "../protyle";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {addLoading} from "../protyle/ui/initUI";
import {getIconByType} from "../editor/getIcon";
import {unicode2Emoji} from "../emoji";

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
        title: text,
        callback(tab) {
            const asset = new Search({
                tab,
                text
            });
            tab.addModel(asset);
            resizeTabs();
        }
    });
    wnd.split("lr").addTab(tab);
};

export const genSearch = (config: ISearchOption, element: Element, closeCB?: () => void) => {
    element.innerHTML = `<div class="fn__flex-column" style="height: 100%">
    <div class="b3-form__icon search__header">
        <span class="fn__a" id="searchHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="searchInput" style="padding-right: 60px" class="b3-text-field b3-text-field--text">
        <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
        <div class="block__icons">
            <span id="searchReplace" aria-label="${window.siyuan.languages.replace}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconEdit"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchPath" aria-label="${window.siyuan.languages.specifyPath}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconFolder"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchRefresh" aria-label="${window.siyuan.languages.refresh}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </span>
            <span class="fn__space"></span>
            <span id="searchFilter" aria-label="${window.siyuan.languages.type}" class="block__icon b3-tooltips b3-tooltips__w">
                <svg><use xlink:href="#iconSettings"></use></svg>
            </span>
        </div>
    </div>
    <div class="b3-form__icon search__header${config.hasReplace ? "" : " fn__none"}">
        <span class="fn__a" id="replaceHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
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
    <div class="fn__flex b3-form__space--small">
        <span id="searchResult" style="white-space: nowrap;"></span>
        <span class="fn__space"></span>
        <span class="fn__flex-1"></span>
        <span id="searchPathInput" class="ft__on-surface fn__flex-center ft__smaller fn__ellipsis" style="white-space: nowrap;" title="${config.hPath}">${config.hPath}</span>
        <span class="fn__space"></span>
        <button id="includeChildCheck" class="b3-button b3-button--small${(config.notebookId && config.idPath && !config.idPath.endsWith(".sy")) ? "" : " b3-button--cancel"}">${window.siyuan.languages.includeChildDoc}</button>
        <span class="fn__space"></span>
        <button id="searchSyntaxCheck" class="b3-button b3-button--small${config.querySyntax ? "" : " b3-button--cancel"}">${window.siyuan.languages.querySyntax}</button>
    </div>
    <div id="searchList" style="position:relative;height:calc(50% - 69px);overflow: auto;padding-bottom: 8px" class="b3-list b3-list--background search__list"></div>
    <div id="searchPreview" class="fn__flex-1 search__preview"></div>
</div>
<div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>`
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
    let clickTimeout: number;
    let inputTimeout: number;

    searchInputElement.value = config.k || "";
    replaceInputElement.value = config.r || "";
    searchInputElement.select();

    element.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement
        while (target && !target.isSameNode(element)) {
            if (target.id === "searchPath") {
                movePathTo([], undefined, (toPath) => {
                    config.idPath = toPath;
                    fetchPost("/api/filetree/getHPathsByPaths", {paths: [toPath]}, (response) => {
                        config.hPath = escapeHtml(response.data.join(", "));
                        element.querySelector("#searchPathInput").innerHTML = escapeHtml(response.data.join(", "));
                    });
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchReplace") {
                element.querySelector("#replaceHistoryBtn").parentElement.classList.toggle("fn__none");
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchRefresh") {
                inputTimeout = inputEvent(element, config, inputTimeout, edit)
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchFilter") {
                window.siyuan.menus.menu.remove();
                addConfigMenu(config, window.siyuan.languages.math, "mathBlock", edit, element);
                addConfigMenu(config, window.siyuan.languages.table, "table", edit, element);
                addConfigMenu(config, window.siyuan.languages.quote, "blockquote", edit, element);
                addConfigMenu(config, window.siyuan.languages.superBlock, "superBlock", edit, element);
                addConfigMenu(config, window.siyuan.languages.paragraph, "paragraph", edit, element);
                addConfigMenu(config, window.siyuan.languages.doc, "document", edit, element);
                addConfigMenu(config, window.siyuan.languages.headings, "heading", edit, element);
                addConfigMenu(config, window.siyuan.languages.list1, "list", edit, element);
                addConfigMenu(config, window.siyuan.languages.listItem, "listItem", edit, element);
                addConfigMenu(config, window.siyuan.languages.code, "codeBlock", edit, element);
                addConfigMenu(config, "HTML", "htmlBlock", edit, element);
                window.siyuan.menus.menu.popup({x: event.clientX - 16, y: event.clientY - 16}, true);
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "includeChildCheck") {
                target.classList.toggle("b3-button--cancel");
                let reload = false;
                if (target.classList.contains("b3-button--cancel")) {
                    if (!config.idPath.endsWith(".sy")) {
                        config.idPath = config.idPath + ".sy";
                        reload = true;
                    }
                } else {
                    if (config.hPath) {
                        reload = true;
                    }
                    if (config.idPath.endsWith(".sy")) {
                        config.idPath = config.idPath.replace(".sy", "");
                        reload = true;
                    }
                }
                if (reload) {
                    localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(config));
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchSyntaxCheck") {
                target.classList.toggle("b3-button--cancel");
                config.querySyntax = !target.classList.contains("b3-button--cancel");
                inputTimeout = inputEvent(element, config, inputTimeout, edit);
                localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(config));
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.id === "searchHistoryBtn") {
                let html = "";
                (config.list || []).forEach((s: string) => {
                    if (s !== searchInputElement.value) {
                        html += `<div class="b3-list-item">${escapeHtml(s)}</div>`;
                    }
                });
                historyElement.classList.remove("fn__none");
                historyElement.innerHTML = html;
                replaceHistoryElement.classList.add("fn__none");
                event.stopPropagation();
                event.preventDefault();
                return;
            } else if (target.id === "replaceHistoryBtn") {
                let html = "";
                (config.replaceList || []).forEach((s: string) => {
                    if (s !== replaceInputElement.value) {
                        html += `<div class="b3-list-item">${escapeHtml(s)}</div>`;
                    }
                });
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
            } else if (target.classList.contains("b3-list-item")) {
                if (target.parentElement.id === "searchHistoryList") {
                    searchInputElement.value = target.textContent;
                    searchInputElement.dispatchEvent(new CustomEvent("blur"));
                    inputTimeout = inputEvent(element, config, inputTimeout, edit);
                } else if (target.parentElement.id === "replaceHistoryList") {
                    replaceInputElement.value = target.textContent;
                    replaceHistoryElement.classList.add("fn__none");
                }
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (target.getAttribute("data-type") === "search-item") {
                if (event.detail === 1) {
                    clickTimeout = window.setTimeout(() => {
                        if (window.siyuan.altIsPressed) {
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
                        } else {
                            searchPanelElement.querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                            target.classList.add("b3-list-item--focus");
                            getArticle({
                                edit,
                                id: target.getAttribute("data-node-id"),
                                k: getKey(target)
                            });
                            searchInputElement.focus();
                        }
                    }, Constants.TIMEOUT_DBLCLICK);
                } else if (event.detail === 2) {
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
                event.preventDefault();
                event.stopPropagation();
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
        let searches: string[] = config.list || [];
        searches.splice(0, 0, searchInputElement.value);
        searches = Array.from(new Set(searches));
        if (searches.length > window.siyuan.config.search.limit) {
            searches.splice(window.siyuan.config.search.limit, searches.length - window.siyuan.config.search.limit);
        }
        config.list = searches;
        config.k = searchInputElement.value;
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(config));
    });
    searchInputElement.addEventListener("focus", () => {
        historyElement.classList.add("fn__none");
        replaceHistoryElement.classList.add("fn__none");
    });
    searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
        if (!currentList || event.isComposing) {
            return;
        }
        if (event.key === "ArrowDown") {
            currentList.classList.remove("b3-list-item--focus");
            if (!currentList.nextElementSibling) {
                searchPanelElement.children[0].classList.add("b3-list-item--focus");
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
                const length = searchPanelElement.children.length;
                searchPanelElement.children[length - 1].classList.add("b3-list-item--focus");
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
    replaceInputElement.addEventListener("focus", () => {
        historyElement.classList.add("fn__none");
        replaceHistoryElement.classList.add("fn__none");
    });
    replaceInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        replace(element, config, edit, false);
        event.preventDefault();
    });
    inputTimeout = inputEvent(element, config, inputTimeout, edit);
}

const addConfigMenu = (config: ISearchOption, lang: string, key: "mathBlock" | "table" | "blockquote" | "superBlock" | "paragraph" | "document" | "heading" | "list" | "listItem" | "codeBlock" | "htmlBlock",
                       edit: Protyle, element: Element) => {
    window.siyuan.menus.menu.append(new MenuItem({
        label: `<div class="fn__flex" style="margin-bottom: 4px"><span>${lang}</span><span class="fn__space fn__flex-1"></span>
<input type="checkbox" class="b3-switch fn__flex-center"${config.types[key] ? " checked" : ""}></div>`,
        bind(menuItemElement) {
            menuItemElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
                const inputElement = menuItemElement.querySelector("input");
                if (event.target.tagName !== "INPUT") {
                    inputElement.checked = !inputElement.checked;
                }
                config.types[key] = inputElement.checked;
                inputEvent(element, config, undefined, edit);
                localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(config));
                window.siyuan.menus.menu.remove();
            });
        }
    }).element);
}

const getKey = (element: HTMLElement) => {
    const keys: string[] = [];
    element.querySelectorAll("mark").forEach(item => {
        keys.push(item.textContent);
    });
    return [...new Set(keys)].join(" ");
};

const getArticle = (options: {
    id: string,
    k: string,
    edit: Protyle
}) => {
    console.log(options.edit);
    fetchPost("/api/block/checkBlockFold", {id: options.id}, (foldResponse) => {
        options.edit.protyle.scroll.lastScrollTop = 0;
        addLoading(options.edit.protyle);
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            k: options.k,
            mode: foldResponse.data ? 0 : 3,
            size: foldResponse.data ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet(getResponse, options.edit.protyle, foldResponse.data ? [Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_HL, Constants.CB_GET_HTML]);
            const matchElement = options.edit.protyle.wysiwyg.element.querySelector(`div[data-node-id="${options.id}"] span[data-type="search-mark"]`);
            if (matchElement) {
                matchElement.scrollIntoView();
            }
        });
    });
};

const replace = (element: Element, config: ISearchOption, edit: Protyle, isAll: boolean) => {
    const searchPanelElement = element.querySelector("#searchList");
    const replaceInputElement = element.querySelector("#replaceInput") as HTMLInputElement;

    const loadElement = replaceInputElement.nextElementSibling;
    if (!loadElement.classList.contains("fn__none")) {
        return;
    }
    let searches: string[] = config.replaceList || [];
    searches.splice(0, 0, replaceInputElement.value);
    searches = Array.from(new Set(searches));
    if (searches.length > window.siyuan.config.search.limit) {
        searches.splice(window.siyuan.config.search.limit, searches.length - window.siyuan.config.search.limit);
    }
    config.replaceList = searches;
    config.r = replaceInputElement.value;
    localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(config));

    let currentList: HTMLElement = searchPanelElement.querySelector(".b3-list-item--focus");
    if (!currentList) {
        return;
    }
    loadElement.classList.remove("fn__none");
    let ids: string[] = [];
    let rootIds: string[] = [];
    if (isAll) {
        searchPanelElement.querySelectorAll(".b3-list-item").forEach(item => {
            ids.push(item.getAttribute("data-node-id"));
            rootIds.push(item.getAttribute("data-root-id"));
        });
    } else {
        ids = [currentList.getAttribute("data-node-id")];
        rootIds = [currentList.getAttribute("data-root-id")];
    }
    fetchPost("/api/search/findReplace", {
        k: getKey(currentList),
        r: replaceInputElement.value,
        ids,
        types: config.types,
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
    const searchInputElement = element.querySelector("#searchInput") as HTMLInputElement;
    const loadingElement = element.querySelector(".fn__loading--top");
    clearTimeout(inputTimeout);
    inputTimeout = window.setTimeout(() => {
        loadingElement.classList.remove("fn__none");
        const inputValue = searchInputElement.value;
        if (inputValue === "") {
            fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                onSearch(response.data, edit, element);
                loadingElement.classList.add("fn__none");
                element.querySelector("#searchResult").innerHTML = "";
            });
        } else {
            fetchPost("/api/search/fullTextSearchBlock", {
                query: inputValue,
                querySyntax: config.querySyntax,
                types: config.types,
                path: config.hPath ? config.idPath : ""
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
        const title = escapeHtml(getNotebookName(item.box)) + getDisplayName(item.hPath, false);
        resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${item.id}" data-root-id="${item.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
<span class="b3-list-item__text">${unicode2Emoji(item.ial.icon)}${item.ial.icon ? "&nbsp;" : ""}${item.content}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis" title="${title}">${title}</span>
</div>`;
    });

    if (data[0]) {
        if (edit) {
            edit.protyle.element.classList.remove("fn__none");
        } else {
            element.querySelector("#searchPreview").classList.remove("fn__none");
        }
        const contentElement = document.createElement("div");
        contentElement.innerHTML = data[0].content;
        getArticle({
            edit,
            id: data[0].id,
            k: getKey(contentElement),
        });
    } else {
        if (edit) {
            edit.protyle.element.classList.add("fn__none");
        } else {
            element.querySelector("#searchPreview").classList.add("fn__none");
        }
    }
    element.querySelector("#searchList").innerHTML = resultHTML || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
};
