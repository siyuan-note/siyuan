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
import {escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";
import {Constants} from "../../constants";
import {isMobile} from "../../util/functions";

export class Inbox extends Model {
    private element: Element;
    private selectIds: string[] = [];
    private currentPage = 1;
    private pageCount = 1;
    private data: { [key: string]: IInbox } = {};

    constructor(tab: Tab | Element) {
        super({id: tab.id});
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
    <div class="fn__flex">
        <input class="fn__flex-center toolbar__icon" data-type="selectall" type="checkbox">  
        <svg class="toolbar__icon" data-type="refresh"><use xlink:href='#iconRefresh'></use></svg>
        <svg data-type="more" class="toolbar__icon fn__none"><use xlink:href='#iconMore'></use></svg>
        <svg data-type="previous" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconLeft'></use></svg>
        <svg data-type="next" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconRight'></use></svg>
    </div>
    <div class="fn__flex fn__none">
        <svg data-type="back" class="toolbar__icon"><use xlink:href='#iconLeft'></use></svg>
        <svg data-type="refreshDetails" class="toolbar__icon"><use xlink:href='#iconRefresh'></use></svg>
        <svg data-type="move" class="toolbar__icon"><use xlink:href='#iconMove'></use></svg>
        <svg data-type="delete" class="toolbar__icon"><use xlink:href='#iconTrashcan'></use></svg>
    </div>
</div>
<div class="fn__flex-1 fn__none inboxDetails ft__breakword" style="padding: 4px"></div>
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
    <div class="fn__flex">
        <input class="fn__flex-center block__icon" data-type="selectall" type="checkbox">  
        <span class="fn__space"></span>
        <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
        <span data-type="more" data-menu="true" class="block__icon b3-tooltips b3-tooltips__sw fn__none" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href='#iconMore'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="previous" class="block__icon b3-tooltips b3-tooltips__sw" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="next" class="block__icon b3-tooltips b3-tooltips__sw" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href='#iconRight'></use></svg></span>
    </div>
    <div class="fn__flex fn__none">
        <span data-type="back" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.back}"><svg><use xlink:href='#iconLeft'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="refreshDetails" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="move" data-menu="true" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.move}"><svg><use xlink:href='#iconMove'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="delete" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href='#iconTrashcan'></use></svg></span>
    </div>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1 fn__none inboxDetails ft__breakword" style="padding: 8px"></div>
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
                const type = target.getAttribute("data-type");
                if (type === "min") {
                    getDockByType("inbox").toggleModel("inbox");
                    event.stopPropagation();
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
                    this.updateAction();
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    event.stopPropagation();
                    break;
                } else if (type === "select") {
                    if ((target.firstElementChild.nextElementSibling as HTMLInputElement).checked) {
                        this.selectIds.push(target.parentElement.getAttribute("data-id"));
                        this.selectIds = [...new Set(this.selectIds)];
                    } else {
                        this.selectIds.splice(this.selectIds.indexOf(target.parentElement.getAttribute("data-id")), 1);
                    }
                    this.updateAction();
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    selectAllElement.checked = this.element.lastElementChild.querySelectorAll("input:checked").length === this.element.lastElementChild.querySelectorAll(".b3-list-item").length;
                    event.stopPropagation();
                    break;
                } else if (type === "previous") {
                    if (target.getAttribute("disabled") !== "disabled") {
                        this.currentPage--;
                        this.update();
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "next") {
                    if (target.getAttribute("disabled") !== "disabled") {
                        this.currentPage++;
                        this.update();
                    }
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "refresh") {
                    this.currentPage = 1;
                    this.update();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "back") {
                    this.back();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "more") {
                    this.more(event);
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "refreshDetails") {
                    fetchPost("/api/inbox/getShorthand", {
                        id: detailsElement.getAttribute("data-id")
                    }, (response) => {
                        detailsElement.innerHTML = `<h3 class="fn__ellipsis">${response.data.shorthandTitle}</h3>
<div class="fn__hr"></div>
<a href="${response.data.shorthandURL}" target="_blank">${response.data.shorthandURL}</a>
<div class="fn__hr"></div>
<div class="b3-typography b3-typography--default">
${(Lute.New()).MarkdownStr("", response.data.shorthandContent)}
</div>`;
                        detailsElement.scrollTop = 0;
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "delete") {
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete + "?", () => {
                        this.remove(detailsElement.getAttribute("data-id"));
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "move") {
                    window.siyuan.menus.menu.remove();
                    window.siyuan.notebooks.forEach((item) => {
                        if (!item.closed) {
                            window.siyuan.menus.menu.append(new MenuItem({
                                iconHTML: `${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE, false, "b3-menu__icon", true)}`,
                                label: escapeHtml(item.name),
                                click: () => {
                                    this.move(item.id, detailsElement.getAttribute("data-id"));
                                }
                            }).element);
                        }
                    });
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                    window.siyuan.menus.menu.element.style.zIndex = "221";  // 移动端被右侧栏遮挡
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("b3-list-item")) {
                    const data = this.data[target.getAttribute("data-id")];
                    this.element.querySelector('[data-type="back"]').parentElement.classList.remove("fn__none");
                    this.element.querySelector('[data-type="more"]').parentElement.classList.add("fn__none");
                    detailsElement.innerHTML = `<h3 class="fn__ellipsis">
${data.shorthandTitle}
</h3>
<div class="fn__hr"></div>
<a href="${data.shorthandURL}" target="_blank">${data.shorthandURL}</a>
<div class="fn__hr"></div>
<div class="b3-typography b3-typography--default">
${(Lute.New()).MarkdownStr("", data.shorthandContent)}
</div>`;
                    detailsElement.setAttribute("data-id", data.oId);
                    detailsElement.classList.remove("fn__none");
                    detailsElement.scrollTop = 0;
                    this.element.lastElementChild.classList.add("fn__none");
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.update();
        /// #if !MOBILE
        setPanelFocus(this.element);
        /// #endif
    }

    private updateAction() {
        if (this.selectIds.length === 0) {
            this.element.querySelector('[data-type="refresh"]').classList.remove("fn__none");
            this.element.querySelector('[data-type="more"]').classList.add("fn__none");
        } else {
            this.element.querySelector('[data-type="refresh"]').classList.add("fn__none");
            this.element.querySelector('[data-type="more"]').classList.remove("fn__none");
        }
    }

    private back() {
        this.element.querySelector('[data-type="back"]').parentElement.classList.add("fn__none");
        this.element.querySelector('[data-type="more"]').parentElement.classList.remove("fn__none");
        this.element.querySelector(".inboxDetails").classList.add("fn__none");
        this.element.lastElementChild.classList.remove("fn__none");
    }

    private more(event: MouseEvent) {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.refresh,
            icon: "iconRefresh",
            click: () => {
                this.currentPage = 1;
                this.update();
            }
        }).element);
        const submenu: IMenu[] = [];
        window.siyuan.notebooks.forEach((item) => {
            if (!item.closed) {
                submenu.push({
                    iconHTML: `${unicode2Emoji(item.icon || Constants.SIYUAN_IMAGE_NOTE, false, "b3-menu__icon", true)}`,
                    label: escapeHtml(item.name),
                    click: () => {
                        this.move(item.id);
                    }
                });
            }
        });
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.move,
            icon: "iconMove",
            submenu
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.remove,
            icon: "iconTrashcan",
            click: () => {
                confirmDialog(window.siyuan.languages.deleteOpConfirm, window.siyuan.languages.confirmDelete + "?", () => {
                    this.remove();
                });
            }
        }).element);
        window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
        window.siyuan.menus.menu.element.style.zIndex = "221";  // 移动端被右侧栏遮挡
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
            this.updateAction();
            this.currentPage = 1;
            this.update();
        });
    }

    private move(notebookId: string, id?: string) {
        let ids: string[];
        if (id) {
            ids = [id];
        } else {
            ids = this.selectIds;
        }

        ids.forEach(item => {
            fetchPost("/api/filetree/createDoc", {
                notebook: notebookId,
                path: `/${Lute.NewNodeID()}.sy`,
                title: replaceFileName(this.data[item].shorthandTitle),
                md: this.data[item].shorthandContent,
            }, () => {
                this.remove(item);
            });
        });
    }

    private update() {
        if (needSubscribe("")) {
            this.element.lastElementChild.innerHTML = `<ul class="b3-list b3-list--background">
    <li class="b3-list--empty">
        相关功能可打开帮助文档搜索 <code>收集箱</code> 查看使用说明
    </li>
    <li class="b3-list--empty">
        ${window.siyuan.config.system.container === "ios" ? window.siyuan.languages._kernel[122] : window.siyuan.languages._kernel[29]}
    </li>
</ul>`;
            return;
        }
        const refreshElement = this.element.querySelector(`[data-type="refresh"]${isMobile() ? "" : " svg"}`);
        if (refreshElement.classList.contains("fn__rotate")) {
            return;
        }
        refreshElement.classList.add("fn__rotate");
        fetchPost("/api/inbox/getShorthands", {page: this.currentPage}, (response) => {
            refreshElement.classList.remove("fn__rotate");
            let html = "";
            if (response.data.data.shorthands.length === 0) {
                html = '<ul class="b3-list b3-list--background"><li class="b3-list--empty">打开帮助文档搜索 <b>收集箱</b> 查看使用说明</li></ul>';
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
