import {Tab} from "../Tab";
import {getDockByType, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {Model} from "../Model";
import {needSubscribe} from "../../util/needSubscribe";
import {MenuItem} from "../../menus/Menu";
import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {confirmDialog} from "../../dialog/confirmDialog";

export class Inbox extends Model {
    private element: Element;
    private selectIds: string[] = [];
    private currentPage = 1;
    private pageCount = 1;
    private data: { [key: string]: IInbox } = {};

    constructor(tab: Tab) {
        super({id: tab.id});
        this.element = tab.panelElement;
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
        <span data-type="move" data-menu="true" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.move}"><svg><use xlink:href='#iconMove'></use></svg></span>
        <span class="fn__space"></span>
        <span data-type="delete" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.remove}"><svg><use xlink:href='#iconTrashcan'></use></svg></span>
    </div>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="inbox__details fn__none"></div>
<div class="fn__flex-1 inbox__list"></div>`;
        const countElement = this.element.querySelector(".inboxSelectCount");
        const detailsElement = this.element.querySelector(".inbox__details");
        const selectAllElement = this.element.querySelector(".block__icons input") as HTMLInputElement;
        this.element.addEventListener("click", (event: MouseEvent) => {
                setPanelFocus(this.element.firstElementChild);
                let target = event.target as HTMLElement;
                while (target && !target.isEqualNode(this.element)) {
                    const typeElement = hasClosestByAttribute(target, "data-type", null);
                    if (typeElement && this.element.contains(typeElement)) {
                        const type = typeElement.getAttribute("data-type");
                        switch (type) {
                            case "min":
                                getDockByType("inbox").toggleModel("inbox");
                                break;
                            case "selectall":
                                if ((typeElement as HTMLInputElement).checked) {
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
                                break;
                            case "select":
                                if ((typeElement.firstElementChild.nextElementSibling as HTMLInputElement).checked) {
                                    this.selectIds.push(typeElement.parentElement.getAttribute("data-id"));
                                    this.selectIds = [...new Set(this.selectIds)];
                                } else {
                                    this.selectIds.splice(this.selectIds.indexOf(typeElement.parentElement.getAttribute("data-id")), 1);
                                }
                                this.updateAction();
                                countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                                selectAllElement.checked = this.element.lastElementChild.querySelectorAll("input:checked").length === this.element.lastElementChild.querySelectorAll(".b3-list-item").length;
                                break;
                            case "previous":
                                if (typeElement.getAttribute("disabled") !== "disabled") {
                                    this.currentPage--;
                                    this.update();
                                }
                                break;
                            case "next":
                                if (typeElement.getAttribute("disabled") !== "disabled") {
                                    this.currentPage++;
                                    this.update();
                                }
                                break;
                            case "refresh":
                                this.currentPage = 1;
                                this.update();
                                break;
                            case "delete":
                                confirmDialog(window.siyuan.languages.delete, window.siyuan.languages.confirmDelete + "?", () => {
                                    this.remove(detailsElement.getAttribute("data-id"));
                                });
                                break;
                            case "move":
                                window.siyuan.menus.menu.remove();
                                window.siyuan.notebooks.forEach((item) => {
                                    if (!item.closed) {
                                        window.siyuan.menus.menu.append(new MenuItem({
                                            label: item.name,
                                            click: () => {
                                                this.move(item.id, detailsElement.getAttribute("data-id"));
                                            }
                                        }).element);
                                    }
                                });
                                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                                break;
                            case "back":
                                this.back();
                                break;
                            case "more":
                                this.more(event);
                                break;
                        }
                        break;
                    } else {
                        const itemElement = hasClosestByClassName(target, "b3-list-item");
                        if (itemElement) {
                            const data = this.data[itemElement.getAttribute("data-id")];
                            this.element.querySelector('[data-type="back"]').parentElement.classList.remove("fn__none");
                            this.element.querySelector('[data-type="more"]').parentElement.classList.add("fn__none");
                            detailsElement.innerHTML = `<h3 class="fn__ellipsis">
${data.shorthandTitle}
</h3>
<div class="fn__hr"></div>
<a href="${data.shorthandURL}" target="_blank">${data.shorthandURL}</a>
<div class="fn__hr"></div>
<div class="b3-typography">
${(Lute.New()).MarkdownStr("", data.shorthandContent)}
</div>`;
                            detailsElement.setAttribute("data-id", data.oId);
                            detailsElement.classList.remove("fn__none");
                            detailsElement.scrollTop = 0;
                            break;
                        }
                    }
                    target = target.parentElement;
                }
            }
        );
        this.update();
        setPanelFocus(this.element.firstElementChild);
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
        this.element.querySelector(".inbox__details").classList.add("fn__none");
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
                    label: item.name,
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
                confirmDialog(window.siyuan.languages.delete, window.siyuan.languages.confirmDelete + "?", () => {
                    this.remove();
                });
            }
        }).element);
        window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
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
                title: this.data[item].shorthandTitle,
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
        const refreshElement = this.element.querySelector('[data-type="refresh"] svg');
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
                html = "<ul class=\"b3-list b3-list--background\">";
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

            const previousElement = this.element.querySelector('span[data-type="previous"]');
            const nextElement = this.element.querySelector('span[data-type="next"]');
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
            (this.element.querySelector(".block__icons input") as HTMLInputElement).checked = this.element.lastElementChild.querySelectorAll("input:checked").length === selectCount && selectCount !== 0;
        });
    }
}
