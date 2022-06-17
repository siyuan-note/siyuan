import {escapeHtml} from "../util/escape";
import {getIconByType} from "../editor/getIcon";
import {getDisplayName, getNotebookName, pathPosix} from "../util/pathName";
import {Constants} from "../constants";
import Protyle from "../protyle";
import {Dialog} from "../dialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {onGet} from "../protyle/util/onGet";
import {openFileById} from "../editor/util";
import {addLoading} from "../protyle/ui/initUI";
import {getAllModels} from "../layout/getAll";
import {showMessage} from "../dialog/message";
import {focusByRange} from "../protyle/util/selection";

let protyle: Protyle;
export const openSearch = async (hotkey: string, key?: string, notebookId?: string, searchPath?: string) => {
    const exitDialog = window.siyuan.dialogs.find((item) => {
        if (item.element.querySelector("#searchList")) {
            const lastKey = item.element.getAttribute("data-key");
            const replaceHeaderElement = item.element.querySelectorAll(".search__header")[1];
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.replace.custom && replaceHeaderElement.classList.contains("fn__none")) {
                replaceHeaderElement.classList.remove("fn__none");
                item.element.setAttribute("data-key", hotkey);
                return true;
            }
            const searchPathElement = item.element.querySelector("#searchPathCheck");
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.globalSearch.custom) {
                if (!searchPathElement.classList.contains("b3-button--cancel")) {
                    searchPathElement.dispatchEvent(new CustomEvent("click"));
                    item.element.setAttribute("data-key", hotkey);
                    return true;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", hotkey);
                    return true;
                }
            }
            if (lastKey !== hotkey && hotkey === window.siyuan.config.keymap.general.search.custom) {
                if (searchPathElement.classList.contains("b3-button--cancel")) {
                    searchPathElement.dispatchEvent(new CustomEvent("click"));
                    item.element.setAttribute("data-key", hotkey);
                    return true;
                } else if (!replaceHeaderElement.classList.contains("fn__none")) {
                    replaceHeaderElement.classList.add("fn__none");
                    item.element.setAttribute("data-key", hotkey);
                    return true;
                }
            }
            item.destroy();
            return true;
        }
    });
    if (exitDialog) {
        return;
    }
    protyle = undefined;
    const localData = JSON.parse(localStorage.getItem(Constants.LOCAL_SEARCHEDATA) || "{}");
    if (!localData.idPath) {
        localData.idPath = "";
    }
    if (!localData.hPath) {
        localData.hPath = "";
    }
    if (key) {
        localData.k = key;
    }
    if (!localData.types) {
        localData.types = {
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
        };
    }
    if (notebookId) {
        localData.hPath = escapeHtml(getNotebookName(notebookId));
        localData.idPath = notebookId;
    }
    if (searchPath && searchPath !== "/") {
        const response = await fetchSyncPost("/api/filetree/getHPathByPath", {
            notebook: notebookId,
            path: searchPath.endsWith(".sy") ? searchPath : searchPath + ".sy"
        });
        localData.hPath = pathPosix().join(localData.hPath, escapeHtml(response.data));
        localData.idPath = pathPosix().join(localData.idPath, searchPath);
    }
    if (notebookId) {
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
    }
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0);
    }
    const dialog = new Dialog({
        content: `<div class="fn__flex">
    <div class="fn__flex-column" style="height:70vh;width:80vw;border-radius: 4px;overflow: hidden;">
    <div class="b3-form__icon search__header">
        <span class="fn__a" id="searchHistoryBtn">
            <svg data-menu="true" class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
            <svg class="search__arrowdown"><use xlink:href="#iconDown"></use></svg>
        </span>
        <input id="searchInput" class="b3-text-field b3-text-field--text fn__block b3-form__icon-input">
        <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    </div>
    <div class="b3-form__icon search__header${hotkey === window.siyuan.config.keymap.general.replace.custom ? "" : " fn__none"}">
        <svg id="replaceHistoryBtn" data-menu="true" class="b3-form__icon-icon fn__a"><use xlink:href="#iconSearch"></use></svg>
        <input id="replaceInput" class="b3-text-field b3-text-field--text fn__block b3-form__icon-input">
        <svg class="fn__rotate fn__none svg" style="padding: 0 8px;align-self: center;"><use xlink:href="#iconRefresh"></use></svg>
        <button id="replaceAllBtn" class="b3-button b3-button--outline fn__flex-center">${window.siyuan.languages.replaceAll}</button>
        <div class="fn__space"></div>
        <button id="replaceBtn" class="b3-button b3-button--outline fn__flex-center">${window.siyuan.languages.replace}</button>
        <div class="fn__space"></div>
        <div id="replaceHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background"></div>
    </div>
    <div class="fn__flex b3-form__space--small">
        <span id="searchPathInput" class="ft__on-surface fn__flex-1 fn__flex-center ft__smaller fn__ellipsis" style="white-space: nowrap;" title="${localData.hPath}">${localData.hPath}</span>
        <span class="fn__space"></span>
        <button id="searchPathCheck" class="b3-button b3-button--small${notebookId ? "" : " b3-button--cancel"}">${window.siyuan.languages.specifyPath}</button>
        <span class="fn__space"></span>
        <button id="includeChildCheck" class="b3-button b3-button--small${(notebookId && localData.idPath && !localData.idPath.endsWith(".sy")) ? "" : " b3-button--cancel"}">${window.siyuan.languages.includeChildDoc}</button>
        <span class="fn__space"></span>
        <button id="searchCaseCheck" class="b3-button b3-button--small${window.siyuan.config.search.caseSensitive ? "" : " b3-button--cancel"}">${window.siyuan.languages.searchCaseSensitive}</button>
        <span class="fn__space"></span>
        <button id="searchSyntaxCheck" class="b3-button b3-button--small${localData.querySyntax ? "" : " b3-button--cancel"}">${window.siyuan.languages.querySyntax}</button>
        <span class="fn__space"></span>
        <span aria-label="${window.siyuan.languages.type}" class="b3-tooltips b3-tooltips__nw">
            <svg class="svg ft__on-surface" id="searchFilter" style="height: 19px;float: left"><use xlink:href="#iconSettings"></use></svg>
        </span>
    </div>
    <div id="searchList" style="position:relative;height:calc(50% - 69px);overflow: auto" class="b3-list b3-list--background"></div>
    <div id="searchPreview" class="fn__flex-1 spread-search__preview"></div></div>
    <div id="searchFilterPanel" class="fn__none spread-search__filter">
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.math}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="mathBlock" type="checkbox"${localData.types.mathBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.table}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="table" type="checkbox"${localData.types.table ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.quote}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="blockquote" type="checkbox"${localData.types.blockquote ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.superBlock}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="superBlock" type="checkbox"${localData.types.superBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.paragraph}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="paragraph" type="checkbox"${localData.types.paragraph ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.doc}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="document" type="checkbox"${localData.types.document ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.headings}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="heading" type="checkbox"${localData.types.heading ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.list1}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="list" type="checkbox"${localData.types.list ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.listItem}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="listItem" type="checkbox"${localData.types.listItem ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                ${window.siyuan.languages.code}
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="codeBlock" type="checkbox"${localData.types.codeBlock ? " checked" : ""}/>
        </label>
        <label class="fn__flex">
            <div class="fn__flex-1 b3-label__text">
                HTML
            </div>
            <span class="fn__space"></span>
            <input class="b3-switch fn__flex-center" id="htmlBlock" type="checkbox"${localData.types.htmlBlock ? " checked" : ""}/>
        </label>
    </div>
    <div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>
</div>`,
        width: "80vw",
        destroyCallback: () => {
            if (range) {
                focusByRange(range);
            }
            if (protyle) {
                protyle.destroy();
            }
        }
    });
    dialog.element.setAttribute("data-key", hotkey);
    dialog.element.firstElementChild.setAttribute("style", "z-index:199"); // https://github.com/siyuan-note/siyuan/issues/3515
    const searchFilterElement = dialog.element.querySelector("#searchFilter") as HTMLInputElement;
    const searchFilterPanelElement = dialog.element.querySelector("#searchFilterPanel") as HTMLInputElement;
    searchFilterElement.addEventListener("click", () => {
        if (searchFilterPanelElement.classList.contains("fn__none")) {
            searchFilterElement.classList.add("ft__primary");
            searchFilterPanelElement.classList.remove("fn__none");
        } else {
            searchFilterElement.classList.remove("ft__primary");
            searchFilterPanelElement.classList.add("fn__none");
        }
    });
    searchFilterPanelElement.querySelectorAll("input").forEach(item => {
        item.addEventListener("change", () => {
            inputEvent();
            localData.types = {
                document: (dialog.element.querySelector("#document") as HTMLInputElement).checked,
                heading: (dialog.element.querySelector("#heading") as HTMLInputElement).checked,
                list: (dialog.element.querySelector("#list") as HTMLInputElement).checked,
                listItem: (dialog.element.querySelector("#listItem") as HTMLInputElement).checked,
                codeBlock: (dialog.element.querySelector("#codeBlock") as HTMLInputElement).checked,
                htmlBlock: (dialog.element.querySelector("#htmlBlock") as HTMLInputElement).checked,
                mathBlock: (dialog.element.querySelector("#mathBlock") as HTMLInputElement).checked,
                table: (dialog.element.querySelector("#table") as HTMLInputElement).checked,
                blockquote: (dialog.element.querySelector("#blockquote") as HTMLInputElement).checked,
                superBlock: (dialog.element.querySelector("#superBlock") as HTMLInputElement).checked,
                paragraph: (dialog.element.querySelector("#paragraph") as HTMLInputElement).checked,
            };
            localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
        });
    });
    const includeChildElement = dialog.element.querySelector("#includeChildCheck");
    const searchPathElement = dialog.element.querySelector("#searchPathCheck");
    searchPathElement.addEventListener("click", () => {
        searchPathElement.classList.toggle("b3-button--cancel");
        if (searchPathElement.classList.contains("b3-button--cancel") && !includeChildElement.classList.contains("b3-button--cancel")) {
            includeChildElement.classList.add("b3-button--cancel");
        }
        inputEvent();
    });
    includeChildElement.addEventListener("click", () => {
        includeChildElement.classList.toggle("b3-button--cancel");
        let reload = false;
        if (includeChildElement.classList.contains("b3-button--cancel")) {
            if (!localData.idPath.endsWith(".sy")) {
                localData.idPath = localData.idPath + ".sy";
                reload = true;
            }
        } else {
            if (searchPathElement.classList.contains("b3-button--cancel")) {
                searchPathElement.classList.remove("b3-button--cancel");
                reload = true;
            }
            if (localData.idPath.endsWith(".sy")) {
                localData.idPath = localData.idPath.replace(".sy", "");
                reload = true;
            }
        }
        if (reload) {
            localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
            inputEvent();
        }
    });
    const searchSyntaxElement = dialog.element.querySelector("#searchSyntaxCheck");
    searchSyntaxElement.addEventListener("click", () => {
        searchSyntaxElement.classList.toggle("b3-button--cancel");
        localData.querySyntax = !searchSyntaxElement.classList.contains("b3-button--cancel");
        inputEvent();
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
    });
    const searchCaseElement = dialog.element.querySelector("#searchCaseCheck");
    searchCaseElement.addEventListener("click", () => {
        searchCaseElement.classList.toggle("b3-button--cancel");
        fetchPost("/api/setting/setSearchCaseSensitive", {caseSensitive: !searchCaseElement.classList.contains("b3-button--cancel")}, () => {
            inputEvent();
            window.siyuan.config.search.caseSensitive = !searchCaseElement.classList.contains("b3-button--cancel");
        });
    });
    const searchPanelElement = dialog.element.querySelector("#searchList");
    const searchInputElement = dialog.element.querySelector("#searchInput") as HTMLInputElement;
    const replaceInputElement = dialog.element.querySelector("#replaceInput") as HTMLInputElement;
    searchInputElement.value = localData.k || "";
    replaceInputElement.value = localData.r || "";
    searchInputElement.select();
    const historyElement = dialog.element.querySelector("#searchHistoryList");
    historyElement.addEventListener("click", (event: Event & { target: HTMLElement }) => {
        if (event.target.classList.contains("b3-list-item")) {
            searchInputElement.value = event.target.textContent;
            searchInputElement.dispatchEvent(new CustomEvent("blur"));
            historyElement.classList.add("fn__none");
            inputEvent();
        }
    });
    dialog.element.querySelector("#searchHistoryBtn").addEventListener("click", () => {
        let html = "";
        (localData.list || []).forEach((s: string) => {
            if (s !== searchInputElement.value) {
                html += `<div class="b3-list-item">${s}</div>`;
            }
        });
        historyElement.classList.remove("fn__none");
        historyElement.innerHTML = html;
        replaceHistoryElement.classList.add("fn__none");
    });
    const replaceHistoryElement = dialog.element.querySelector("#replaceHistoryList");
    replaceHistoryElement.addEventListener("click", (event: Event & { target: HTMLElement }) => {
        if (event.target.classList.contains("b3-list-item")) {
            replaceInputElement.value = event.target.textContent;
            replaceHistoryElement.classList.add("fn__none");
        }
    });
    dialog.element.querySelector("#replaceHistoryBtn").addEventListener("click", () => {
        let html = "";
        (localData.replaceList || []).forEach((s: string) => {
            if (s !== replaceInputElement.value) {
                html += `<div class="b3-list-item">${s}</div>`;
            }
        });
        replaceHistoryElement.classList.remove("fn__none");
        replaceHistoryElement.innerHTML = html;
        historyElement.classList.add("fn__none");
    });
    let inputTimeout = 0;
    const loadingElement = dialog.element.querySelector(".fn__loading--top");
    const inputEvent = (event?: InputEvent) => {
        if (event && event.isComposing) {
            return;
        }
        clearTimeout(inputTimeout);
        inputTimeout = window.setTimeout(() => {
            loadingElement.classList.remove("fn__none");
            const inputValue = searchInputElement.value;
            if (inputValue === "") {
                fetchPost("/api/block/getRecentUpdatedBlocks", {}, (response) => {
                    onSearch(response.data, dialog);
                    loadingElement.classList.add("fn__none");
                });
            } else {
                fetchPost("/api/search/fullTextSearchBlock", {
                    query: inputValue,
                    querySyntax: localData.querySyntax,
                    types: {
                        document: (dialog.element.querySelector("#document") as HTMLInputElement).checked,
                        heading: (dialog.element.querySelector("#heading") as HTMLInputElement).checked,
                        list: (dialog.element.querySelector("#list") as HTMLInputElement).checked,
                        listItem: (dialog.element.querySelector("#listItem") as HTMLInputElement).checked,
                        codeBlock: (dialog.element.querySelector("#codeBlock") as HTMLInputElement).checked,
                        htmlBlock: (dialog.element.querySelector("#htmlBlock") as HTMLInputElement).checked,
                        mathBlock: (dialog.element.querySelector("#mathBlock") as HTMLInputElement).checked,
                        table: (dialog.element.querySelector("#table") as HTMLInputElement).checked,
                        blockquote: (dialog.element.querySelector("#blockquote") as HTMLInputElement).checked,
                        superBlock: (dialog.element.querySelector("#superBlock") as HTMLInputElement).checked,
                        paragraph: (dialog.element.querySelector("#paragraph") as HTMLInputElement).checked,
                    },
                    path: !searchPathElement.classList.contains("b3-button--cancel") ? localData.idPath : ""
                }, (response) => {
                    onSearch(response.data, dialog);
                    loadingElement.classList.add("fn__none");
                });
            }
        }, Constants.TIMEOUT_SEARCH);
    };
    searchInputElement.addEventListener("compositionend", (event: InputEvent) => {
        inputEvent(event);
    });
    searchInputElement.addEventListener("input", (event: InputEvent) => {
        inputEvent(event);
    });
    searchInputElement.addEventListener("blur", () => {
        let searches: string[] = localData.list || [];
        searches.splice(0, 0, searchInputElement.value);
        searches = Array.from(new Set(searches));
        if (searches.length > window.siyuan.config.search.limit) {
            searches.splice(window.siyuan.config.search.limit, searches.length - window.siyuan.config.search.limit);
        }
        localData.list = searches;
        localData.k = searchInputElement.value;
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));
    });
    searchInputElement.addEventListener("focus", () => {
        historyElement.classList.add("fn__none");
        replaceHistoryElement.classList.add("fn__none");
    });
    const lineHeight = 28;
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
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                getArticle({
                    dialog,
                    folded: foldResponse.data,
                    id,
                    k: searchInputElement.value,
                });
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
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                getArticle({
                    dialog,
                    folded: foldResponse.data,
                    id,
                    k: searchInputElement.value,
                });
            });
            event.preventDefault();
        } else if (event.key === "Enter") {
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                openFileById({
                    id,
                    hasContext: !foldResponse.data,
                    action: [Constants.CB_GET_FOCUS],
                    zoomIn: foldResponse.data
                });
                dialog.destroy();
            });
            event.preventDefault();
        }
    });

    const replace = (isAll: boolean) => {
        const loadElement = replaceInputElement.nextElementSibling;
        if (!loadElement.classList.contains("fn__none")) {
            return;
        }
        let searches: string[] = localData.replaceList || [];
        searches.splice(0, 0, replaceInputElement.value);
        searches = Array.from(new Set(searches));
        if (searches.length > window.siyuan.config.search.limit) {
            searches.splice(window.siyuan.config.search.limit, searches.length - window.siyuan.config.search.limit);
        }
        localData.replaceList = searches;
        localData.r = replaceInputElement.value;
        localStorage.setItem(Constants.LOCAL_SEARCHEDATA, JSON.stringify(localData));

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
            k: searchInputElement.value,
            r: replaceInputElement.value,
            ids,
            types: {
                document: (dialog.element.querySelector("#document") as HTMLInputElement).checked,
                heading: (dialog.element.querySelector("#heading") as HTMLInputElement).checked,
                list: (dialog.element.querySelector("#list") as HTMLInputElement).checked,
                listItem: (dialog.element.querySelector("#listItem") as HTMLInputElement).checked,
                codeBlock: (dialog.element.querySelector("#codeBlock") as HTMLInputElement).checked,
                htmlBlock: (dialog.element.querySelector("#htmlBlock") as HTMLInputElement).checked,
                mathBlock: (dialog.element.querySelector("#mathBlock") as HTMLInputElement).checked,
                table: (dialog.element.querySelector("#table") as HTMLInputElement).checked,
                blockquote: (dialog.element.querySelector("#blockquote") as HTMLInputElement).checked,
                superBlock: (dialog.element.querySelector("#superBlock") as HTMLInputElement).checked,
                paragraph: (dialog.element.querySelector("#paragraph") as HTMLInputElement).checked,
            },
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
                    item.editor.reload();
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
                protyle.protyle.element.classList.add("fn__none");
                return;
            }
            currentList = searchPanelElement.querySelector(".b3-list-item--focus");
            if (searchPanelElement.scrollTop < currentList.offsetTop - searchPanelElement.clientHeight + lineHeight ||
                searchPanelElement.scrollTop > currentList.offsetTop) {
                searchPanelElement.scrollTop = currentList.offsetTop - searchPanelElement.clientHeight + lineHeight;
            }
            const id = currentList.getAttribute("data-node-id");
            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                getArticle({
                    dialog,
                    folded: foldResponse.data,
                    id,
                    k: searchInputElement.value,
                });
            });
        });
    };
    replaceInputElement.addEventListener("focus", () => {
        historyElement.classList.add("fn__none");
        replaceHistoryElement.classList.add("fn__none");
    });
    replaceInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || event.key !== "Enter") {
            return;
        }
        event.preventDefault();
        replace(false);
    });
    dialog.element.querySelector("#replaceAllBtn").addEventListener("click", () => {
        replace(true);
    });
    dialog.element.querySelector("#replaceBtn").addEventListener("click", () => {
        replace(false);
    });
    let clickTimeout: number;
    searchPanelElement.addEventListener("click", (event: MouseEvent) => {
        let target = event.target as HTMLElement;
        while (target && !target.isEqualNode(dialog.element)) {
            if (target.getAttribute("data-type") === "search-item") {
                if (event.detail === 1) {
                    clickTimeout = window.setTimeout(() => {
                        if (window.siyuan.altIsPressed) {
                            const id = target.getAttribute("data-node-id");
                            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                                openFileById({
                                    id,
                                    hasContext: !foldResponse.data,
                                    action: [Constants.CB_GET_FOCUS],
                                    zoomIn: foldResponse.data,
                                    position: "right"
                                });
                                dialog.destroy();
                            });
                        } else {
                            searchPanelElement.querySelector(".b3-list-item--focus").classList.remove("b3-list-item--focus");
                            target.classList.add("b3-list-item--focus");
                            const id = target.getAttribute("data-node-id");
                            fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                                getArticle({
                                    dialog,
                                    folded: foldResponse.data,
                                    id,
                                    k: searchInputElement.value,
                                });
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
                            hasContext: !foldResponse.data,
                            action: [Constants.CB_GET_FOCUS],
                            zoomIn: foldResponse.data
                        });
                        dialog.destroy();
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

    inputEvent();
};

const getArticle = (options: {
    id: string,
    folded: boolean,
    k: string,
    dialog: Dialog
}) => {
    if (!protyle) {
        protyle = new Protyle(options.dialog.element.querySelector("#searchPreview") as HTMLElement, {
            blockId: options.id,
            hasContext: !options.folded,
            key: options.k,
            render: {
                gutter: true,
                breadcrumbDocName: true
            },
        });
    } else {
        protyle.protyle.scroll.lastScrollTop = 0;
        addLoading(protyle.protyle);
        fetchPost("/api/filetree/getDoc", {
            id: options.id,
            k: options.k,
            mode: options.folded ? 0 : 3,
            size: options.folded ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, protyle.protyle, options.folded ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL]);
        });
    }
};

const onSearch = (data: IBlock[], dialog: Dialog) => {
    let resultHTML = "";
    data.forEach((item, index) => {
        const title = escapeHtml(getNotebookName(item.box)) + getDisplayName(item.hPath, false);
        resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-node-id="${item.id}" data-root-id="${item.rootID}">
<svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
<span class="b3-list-item__text">${item.content}</span>
<span class="b3-list-item__meta b3-list-item__meta--ellipsis" title="${Lute.EscapeHTMLStr(title)}">${Lute.EscapeHTMLStr(title)}</span>
</div>`;
    });

    if (data[0]) {
        if (protyle) {
            protyle.protyle.element.classList.remove("fn__none");
        } else {
            dialog.element.querySelector("#searchPreview").classList.remove("fn__none");
        }
        fetchPost("/api/block/checkBlockFold", {id: data[0].id}, (foldResponse) => {
            getArticle({
                dialog,
                folded: foldResponse.data,
                id: data[0].id,
                k: (dialog.element.querySelector("input") as HTMLInputElement).value,
            });
        });
    } else {
        if (protyle) {
            protyle.protyle.element.classList.add("fn__none");
        } else {
            dialog.element.querySelector("#searchPreview").classList.add("fn__none");
        }
    }
    dialog.element.querySelector("#searchList").innerHTML = resultHTML || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
};
