/// #if !MOBILE
import {Tab} from "../Tab";
import {getDockByType, setPanelFocus} from "../util";
/// #endif
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {Model} from "../Model";
import {needSubscribe} from "../../util/needSubscribe";
import {MenuItem} from "../../menus/Menu";
import {confirmDialog} from "../../dialog/confirmDialog";
import {replaceFileName} from "../../editor/rename";
import {getDisplayName, movePathTo, pathPosix} from "../../util/pathName";
import {App} from "../../index";
import {getCloudURL} from "../../config/util/about";

export class Inbox extends Model {
    private element: Element;
    private selectIds: string[] = [];
    private currentPage = 1;
    private pageCount = 1;
    private data: { [key: string]: IInbox } = {};

    constructor(app: App, tab: Tab | Element) {
        super({app, id: tab.id});
        if (tab instanceof Element) {
            this.element = tab;
        } else {
            this.element = tab.panelElement;
        }
        /// #if MOBILE
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.inbox}
        <span class="fn__space"></span>
        <span class="inboxSelectCount ft__smaller ft__on-surface"></span>
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <input class="toolbar__icon" data-type="selectall" type="checkbox">  
    <svg data-type="previous" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconLeft'></use></svg>
    <svg data-type="next" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconRight'></use></svg>
    <svg data-type="more" class="toolbar__icon"><use xlink:href='#iconMore'></use></svg>
</div>
<div class="fn__loading fn__none">
    <img width="64px" src="/stage/loading-pure.svg"></div>
</div>
<div class="fn__flex-1 fn__none inboxDetails fn__flex-column" style="min-height: auto"></div>
<div class="fn__flex-1"></div>`;
        /// #else
        this.element.classList.add("fn__flex-column", "file-tree", "sy__inbox");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconInbox"></use></svg>
        ${window.siyuan.languages.inbox}&nbsp;
         <span class="inboxSelectCount"></span>
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <input class="block__icon" data-type="selectall" type="checkbox">  
    <span class="fn__space"></span>
    <span data-type="previous" class="block__icon b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="next" class="block__icon b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="more" data-menu="true" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href='#iconMore'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__loading fn__none">
    <img width="64px" src="/stage/loading-pure.svg"></div>
</div>
<div class="fn__flex-1 fn__none inboxDetails fn__flex-column" style="min-height: auto"></div>
<div class="fn__flex-1"></div>`;
        /// #endif
        const countElement = this.element.querySelector(".inboxSelectCount");
        const detailsElement = this.element.querySelector(".inboxDetails");
        const selectAllElement = this.element.firstElementChild.querySelector("input");
        this.element.addEventListener("click", (event: MouseEvent) => {
            /// #if !MOBILE
            setPanelFocus(this.element);
            /// #endif
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "A") {
                    event.stopPropagation();
                    break;
                }
                const type = target.getAttribute("data-type");
                if (type === "min") {
                    getDockByType("inbox").toggleModel("inbox");
                    event.preventDefault();
                    break;
                } else if (type === "selectall") {
                    if ((target as HTMLInputElement).checked) {
                        this.element.lastElementChild.querySelectorAll(".b3-list-item").forEach(item => {
                            item.querySelector("input").checked = true;
                            this.selectIds.push(item.getAttribute("data-id"));
                            this.selectIds = [...new Set(this.selectIds)];
                        });
                    } else {
                        this.element.lastElementChild.querySelectorAll(".b3-list-item").forEach(item => {
                            item.querySelector("input").checked = false;
                            this.selectIds.splice(this.selectIds.indexOf(item.getAttribute("data-id")), 1);
                        });
                    }
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "select") {
                    if ((target.firstElementChild.nextElementSibling as HTMLInputElement).checked) {
                        this.selectIds.push(target.parentElement.getAttribute("data-id"));
                        this.selectIds = [...new Set(this.selectIds)];
                    } else {
                        this.selectIds.splice(this.selectIds.indexOf(target.parentElement.getAttribute("data-id")), 1);
                    }
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    selectAllElement.checked = this.element.lastElementChild.querySelectorAll("input:checked").length === this.element.lastElementChild.querySelectorAll(".b3-list-item").length;
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "previous") {
                    if (target.getAttribute("disabled") !== "disabled") {
                        this.currentPage--;
                        this.update();
                    }
                    event.preventDefault();
                    break;
                } else if (type === "next") {
                    if (target.getAttribute("disabled") !== "disabled") {
                        this.currentPage++;
                        this.update();
                    }
                    event.preventDefault();
                    break;
                } else if (type === "back") {
                    this.back();
                    event.preventDefault();
                    break;
                } else if (type === "more") {
                    this.more(event);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("b3-list-item")) {
                    const data = this.data[target.getAttribute("data-id")];
                    selectAllElement.classList.add("fn__none");
                    this.element.firstElementChild.querySelector('[data-type="previous"]').classList.add("fn__none");
                    this.element.firstElementChild.querySelector('[data-type="next"]').classList.add("fn__none");
                    detailsElement.innerHTML = this.genDetail(data);
                    detailsElement.setAttribute("data-id", data.oId);
                    detailsElement.classList.remove("fn__none");
                    detailsElement.scrollTop = 0;
                    this.element.lastElementChild.classList.add("fn__none");
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.update();
    }

    private back() {
        this.element.firstElementChild.querySelector("input").classList.remove("fn__none");
        this.element.firstElementChild.querySelector('[data-type="previous"]').classList.remove("fn__none");
        this.element.firstElementChild.querySelector('[data-type="next"]').classList.remove("fn__none");
        this.element.querySelector(".inboxDetails").classList.add("fn__none");
        this.element.lastElementChild.classList.remove("fn__none");
    }

    private genDetail(data: IInbox) {
        let linkHTML = "";
        /// #if MOBILE
        if (data.shorthandURL) {
            linkHTML = `<a href="${data.shorthandURL}" target="_blank">
        <svg class="toolbar__icon" style="float: left"><use xlink:href="#iconLink"></use></svg>
    </a>`;
        }
        return `<div class="toolbar toolbar--dark">
    <svg data-type="back" class="toolbar__icon"><use xlink:href="#iconLeft"></use></svg>
    <span data-type="back" class="toolbar__text fn__flex-1">${data.shorthandTitle}</span>
    ${linkHTML}
</div>
<div class="b3-typography b3-typography--default" style="padding: 0 8px 8px">
${(Lute.New()).MarkdownStr("", data.shorthandContent)}
</div>`;
        /// #else
        if (data.shorthandURL) {
            linkHTML = `<span class="fn__space"></span><a href="${data.shorthandURL}" target="_blank" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.link}">
        <svg><use xlink:href="#iconLink"></use></svg>
    </a>`;
        }
        return `<div class="block__icons">
    <div class="block__logo fn__pointer fn__flex-1" data-type="back">
        <svg><use xlink:href="#iconLeft"></use></svg><span class="ft__breakword">${data.shorthandTitle}</span>
    </div>
    ${linkHTML}
</div>
<div class="b3-typography b3-typography--default" style="padding: 0 8px 8px;user-select: text">
${(Lute.New()).MarkdownStr("", data.shorthandContent)}
</div>`;
        /// #endif
    }

    private more(event: MouseEvent) {
        const detailsElement = this.element.querySelector(".inboxDetails");
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.refresh,
            icon: "iconRefresh",
            click: () => {
                if (detailsElement.classList.contains("fn__none")) {
                    this.currentPage = 1;
                    this.update();
                } else {
                    fetchPost("/api/inbox/getShorthand", {
                        id: detailsElement.getAttribute("data-id")
                    }, (response) => {
                        detailsElement.innerHTML = this.genDetail(response.data);
                        detailsElement.scrollTop = 0;
                    });
                }
            }
        }).element);
        let ids: string[] = [];
        if (detailsElement.classList.contains("fn__none")) {
            ids = this.selectIds;
        } else {
            ids = [detailsElement.getAttribute("data-id")];
        }
        if (ids.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.move,
                icon: "iconMove",
                click: () => {
                    this.move(ids);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.remove,
                icon: "iconTrashcan",
                click: () => {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete + "?", () => {
                        if (detailsElement.classList.contains("fn__none")) {
                            this.remove();
                        } else {
                            this.remove(detailsElement.getAttribute("data-id"));
                        }
                    });
                }
            }).element);
        }

        window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 16});
    }

    private remove(id?: string) {
        let ids: string[];
        if (id) {
            ids = [id];
        } else {
            ids = this.selectIds;
        }
        fetchPost("/api/inbox/removeShorthands", {ids}, () => {
            if (id) {
                this.back();
                this.selectIds.find((item, index) => {
                    if (item === id) {
                        this.selectIds.splice(index, 1);
                        return true;
                    }
                });
            } else {
                this.selectIds = [];
            }
            this.currentPage = 1;
            this.update();
        });
    }

    private move(ids: string[]) {
        movePathTo((toPath, toNotebook) => {
            ids.forEach(item => {
                fetchPost("/api/filetree/createDoc", {
                    notebook: toNotebook[0],
                    path: pathPosix().join(getDisplayName(toPath[0], false, true), Lute.NewNodeID() + ".sy"),
                    title: replaceFileName(this.data[item].shorthandTitle),
                    md: this.data[item].shorthandContent,
                }, () => {
                    this.remove(item);
                });
            });
        });
    }

    private update() {
        const loadingElement = this.element.querySelector(".fn__loading");
        if (needSubscribe("")) {
            this.element.lastElementChild.innerHTML = `<ul class="b3-list b3-list--background">
    <li class="b3-list--empty">
        ${window.siyuan.languages.inboxTip}
    </li>
    <li class="b3-list--empty">
        ${window.siyuan.config.system.container === "ios" ? window.siyuan.languages._kernel[122] : window.siyuan.languages._kernel[29].replace("${url}", getCloudURL("subscribe/siyuan"))}
    </li>
</ul>`;
            loadingElement.classList.add("fn__none");
            return;
        }
        if (!loadingElement.classList.contains("fn__none")) {
            return;
        }
        loadingElement.classList.remove("fn__none");
        fetchPost("/api/inbox/getShorthands", {page: this.currentPage}, (response) => {
            loadingElement.classList.add("fn__none");
            let html = "";
            if (response.data.data.shorthands.length === 0) {
                html = `<ul class="b3-list b3-list--background"><li class="b3-list--empty">${window.siyuan.languages.inboxTip}</li></ul>`;
            } else {
                html = '<ul style="padding: 8px 0" class="b3-list b3-list--background">';
                response.data.data.shorthands.forEach((item: IInbox) => {
                    html += `<li style="padding-left: 0" data-id="${item.oId}" class="b3-list-item">
    <label data-type="select" class="fn__flex">
        <span class="fn__space"></span>
        <input class="fn__flex-center" type="checkbox"${this.selectIds.includes(item.oId) ? " checked" : ""}>
        <span class="fn__space"></span>
    </label>
    <span class="b3-list-item__text" title="${item.shorthandTitle}${item.shorthandTitle === item.shorthandDesc ? "" : "\n" + item.shorthandDesc}">${item.shorthandTitle}</span>
    <span class="b3-list-item__meta">${item.hCreated}</span>
</li>`;
                    this.data[item.oId] = item;
                });
                html += "</ul>";
            }
            this.element.lastElementChild.innerHTML = html;

            this.pageCount = response.data.data.pagination.paginationRecordCount;
            this.element.querySelector(".inboxSelectCount").innerHTML = `${this.selectIds.length}/${this.pageCount}`;

            const previousElement = this.element.querySelector('[data-type="previous"]');
            const nextElement = this.element.querySelector('[data-type="next"]');
            if (response.data.data.pagination.paginationPageCount > this.currentPage) {
                nextElement.removeAttribute("disabled");
            } else {
                nextElement.setAttribute("disabled", "disabled");
            }
            if (this.currentPage === 1) {
                previousElement.setAttribute("disabled", "disabled");
            } else {
                previousElement.removeAttribute("disabled");
            }
            const selectCount = this.element.lastElementChild.querySelectorAll(".b3-list-item").length;
            this.element.firstElementChild.querySelector("input").checked = this.element.lastElementChild.querySelectorAll("input:checked").length === selectCount && selectCount !== 0;
            this.element.lastElementChild.scrollTop = 0;
        });
    }
}
