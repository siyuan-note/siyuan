import {Model} from "../layout/Model";
import {Tab} from "../layout/Tab";
import Protyle from "../protyle";
import {Constants} from "../constants";
import {getIconByType} from "../editor/getIcon";
import {getDisplayName, getNotebookName} from "../util/pathName";
import {setPanelFocus} from "../layout/util";
import {escapeHtml} from "../util/escape";
import {fetchPost} from "../util/fetch";
import {onGet} from "../protyle/util/onGet";
import {openFileById} from "../editor/util";
import {addLoading} from "../protyle/ui/initUI";

export class Search extends Model {
    public text: string;
    private element: HTMLElement;
    public protyle: Protyle;
    private inputTimeout: number;

    constructor(options: { tab: Tab, text: string }) {
        super({
            id: options.tab.id,
        });
        this.element = options.tab.panelElement as HTMLElement;
        this.text = options.text;
        options.tab.updateTitle(this.text);

        this.element.innerHTML = `<div class="fn__flex-column" style="height: 100%">
    <div class="fn__flex-1 fn__flex-column" style="min-height: 50%;">
        <div class="fn__flex" style="padding: 4px 8px;position: relative">
            <span style="opacity: 1" class="block__icon fn__flex-center" id="searchHistoryBtn" data-menu="true">
                <svg><use xlink:href="#iconSearch"></use></svg>
                <svg style="height: 8px;"><use xlink:href="#iconDown"></use></svg>
            </span>
            <div class="fn__space"></div>
            <input class="b3-text-field fn__flex-1">
            <span class="fn__space"></span>
            <span style="opacity: 1" class="block__icon fn__flex-center b3-tooltips b3-tooltips__w" id="globalSearchReload" aria-label="${window.siyuan.languages.refresh}">
                <svg><use xlink:href="#iconRefresh"></use></svg>
            </span>
            <div id="searchHistoryList" data-close="false" class="fn__none b3-menu b3-list b3-list--background" style="position: absolute;top: 30px;max-height: 50vh;overflow: auto"></div>
        </div>
        <div id="globalSearchList" class="fn__flex-1 b3-list b3-list--background"></div>
        <div class="fn__loading fn__loading--top"><img width="120px" src="/stage/loading-pure.svg"></div>
    </div>
    <div class="fn__flex-1" id="searchPreview"></div>
</div>`;
        const historyElement = this.element.querySelector("#searchHistoryList") as HTMLInputElement;
        const inputElement = this.element.querySelector(".b3-text-field") as HTMLInputElement;
        inputElement.value = this.text;
        inputElement.addEventListener("compositionend", (event: InputEvent) => {
            this.inputEvent(inputElement, event);
        });
        inputElement.addEventListener("input", (event: InputEvent) => {
            this.inputEvent(inputElement, event);
        });
        inputElement.addEventListener("blur", () => {
            this.setLocalStorage(inputElement.value);
        });
        const lineHeight = 30;
        const searchPanelElement = this.element.querySelector("#globalSearchList");
        inputElement.addEventListener("keydown", (event) => {
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
                addLoading(this.protyle.protyle);
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    fetchPost("/api/filetree/getDoc", {
                        id,
                        k: inputElement.value,
                        mode: foldResponse.data ? 0 : 3,
                        size: foldResponse.data ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, this.protyle.protyle, foldResponse.data ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL]);
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
                addLoading(this.protyle.protyle);
                const id = currentList.getAttribute("data-node-id");
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    fetchPost("/api/filetree/getDoc", {
                        id,
                        k: inputElement.value,
                        mode: foldResponse.data ? 0 : 3,
                        size: foldResponse.data ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, this.protyle.protyle, foldResponse.data ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL]);
                    });
                });
                event.preventDefault();
            }
        });
        inputElement.select();
        this.inputEvent(inputElement);
        let clickTimeout: number;
        this.element.addEventListener("click", (event: MouseEvent) => {
            setPanelFocus(this.element.parentElement.parentElement);
            let target = event.target as HTMLElement;
            let hideList = true;
            while (target && !target.isEqualNode(this.element)) {
                if (target.id === "globalSearchReload") {
                    this.inputEvent(inputElement);
                } else if (target.classList.contains("b3-list-item")) {
                    if (target.getAttribute("data-node-id")) {
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
                                            position: "right",
                                        });
                                    });
                                } else {
                                    this.element.querySelectorAll(".b3-list-item--focus").forEach((item) => {
                                        item.classList.remove("b3-list-item--focus");
                                    });
                                    target.classList.add("b3-list-item--focus");
                                    this.protyle.protyle.scroll.lastScrollTop = 0;
                                    const id = target.getAttribute("data-node-id");
                                    addLoading(this.protyle.protyle);
                                    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                                        fetchPost("/api/filetree/getDoc", {
                                            id,
                                            k: inputElement.value,
                                            mode: foldResponse.data ? 0 : 3,
                                            size: foldResponse.data ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                                        }, getResponse => {
                                            onGet(getResponse, this.protyle.protyle, foldResponse.data ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL]);
                                        });
                                    });
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
                            });
                        }
                        window.siyuan.menus.menu.remove();
                    } else {
                        this.text = target.textContent;
                        this.parent.updateTitle(this.text);
                        inputElement.value = this.text;
                        inputElement.select();
                        this.inputEvent(inputElement);
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.id === "searchHistoryBtn") {
                    hideList = false;
                    let html = "";
                    const data = JSON.parse(localStorage.getItem(Constants.LOCAL_SEARCHETABDATA) || "[]");
                    data.forEach((s: string) => {
                        if (s !== inputElement.value) {
                            html += `<div class="b3-list-item">${s}</div>`;
                        }
                    });
                    historyElement.classList.remove("fn__none");
                    historyElement.innerHTML = html;
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
            if (hideList) {
                historyElement.classList.add("fn__none");
            }
        }, false);
    }

    private setLocalStorage(value: string) {
        if (!value) {
            return;
        }
        let searches: string[] = JSON.parse(localStorage.getItem(Constants.LOCAL_SEARCHETABDATA) || "[]");
        searches.splice(0, 0, value);
        searches = Array.from(new Set(searches));
        if (searches.length > window.siyuan.config.search.limit) {
            searches.splice(window.siyuan.config.search.limit, searches.length - window.siyuan.config.search.limit);
        }
        localStorage.setItem(Constants.LOCAL_SEARCHETABDATA, JSON.stringify(searches));
    }

    private inputEvent(inputElement: HTMLInputElement, event?: InputEvent) {
        if (event && event.isComposing) {
            return;
        }
        clearTimeout(this.inputTimeout);
        const loadElement = this.element.querySelector(".fn__loading--top");
        this.inputTimeout = window.setTimeout(() => {
            this.text = inputElement.value;
            this.parent.updateTitle(this.text);
            loadElement.classList.remove("fn__none");
            fetchPost("/api/search/fullTextSearchBlock", {query: this.text}, (response) => {
                this.onSearch(response.data);
                loadElement.classList.add("fn__none");
            });
        }, Constants.TIMEOUT_SEARCH);
    }

    public updateSearch(text: string, replace: boolean) {
        const inputElement = this.element.querySelector(".b3-text-field") as HTMLInputElement;
        if (text === "") {
            inputElement.select();
            return;
        }
        const oldText = inputElement.value;
        if (oldText === text) {
            return;
        }
        if (!replace) {
            if (oldText.indexOf(text) > -1) {
                text = oldText.replace(text + " ", "").replace(" " + text, "");
            } else if (oldText !== "") {
                text = oldText + " " + text;
            }
        }
        this.text = text;
        this.parent.updateTitle(this.text);
        inputElement.value = this.text;
        inputElement.select();
        this.inputEvent(inputElement);
        this.setLocalStorage(text);
    }

    private onSearch(data: IBlock[]) {
        let resultHTML = "";
        data.forEach((item, index) => {
            const title = escapeHtml(getNotebookName(item.box)) + getDisplayName(item.hPath, false);
            resultHTML += `<div data-type="search-item" class="b3-list-item${index === 0 ? " b3-list-item--focus" : ""}" data-url="${item.box}" data-path="${item.path}" data-node-id="${item.id}">
    <svg class="b3-list-item__graphic"><use xlink:href="#${getIconByType(item.type)}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
    <span class="b3-list-item__meta b3-list-item__meta--ellipsis" title="${Lute.EscapeHTMLStr(title)}">${Lute.EscapeHTMLStr(title)}</span>
</div>`;
        });
        this.element.querySelector("#globalSearchList").innerHTML = resultHTML || `<div class="b3-list--empty">${window.siyuan.languages.emptyContent}</div>`;
        if (data.length === 0) {
            if (this.protyle) {
                this.protyle.protyle.element.classList.add("fn__none");
            }
            return;
        }
        fetchPost("/api/block/checkBlockFold", {id: data[0].id}, (foldResponse) => {
            if (this.protyle) {
                this.protyle.protyle.element.classList.remove("fn__none");
                this.protyle.protyle.scroll.lastScrollTop = 0;
                addLoading(this.protyle.protyle);
                fetchPost("/api/filetree/getDoc", {
                    id: data[0].id,
                    k: (this.element.querySelector(".b3-text-field") as HTMLInputElement).value,
                    mode: foldResponse.data ? 0 : 3,
                    size: foldResponse.data ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
                }, getResponse => {
                    onGet(getResponse, this.protyle.protyle, foldResponse.data ? [Constants.CB_GET_ALL] : [Constants.CB_GET_HL]);
                });
            } else {
                this.protyle = new Protyle(this.element.querySelector("#searchPreview") as HTMLElement, {
                    blockId: data[0].id,
                    hasContext: !foldResponse.data,
                    key: (this.element.querySelector(".b3-text-field") as HTMLInputElement).value,
                    render: {
                        gutter: true,
                        breadcrumbDocName: true,
                    },
                });
            }
        });
    }
}
