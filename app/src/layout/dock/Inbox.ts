/// #if !MOBILE
import {Tab} from "../Tab";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
/// #endif
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {Model} from "../Model";
import {needSubscribe} from "../../util/needSubscribe";
import {MenuItem} from "../../menus/Menu";
import {confirmDialog} from "../../dialog/confirmDialog";
import {replaceFileName} from "../../editor/rename";
import {getDisplayName, movePathTo, pathPosix} from "../../util/pathName";
import {App} from "../../index";
import {getCloudURL} from "../../config/util/about";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {escapeHtml} from "../../util/escape";
import {emitOpenMenu} from "../../plugin/EventBus";

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
    <svg data-type="selectall" class="toolbar__icon"><use xlink:href="#iconUncheck"></use></svg>
    <svg data-type="previous" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconLeft'></use></svg>
    <svg data-type="next" disabled="disabled" class="toolbar__icon"><use xlink:href='#iconRight'></use></svg>
    <svg data-type="more" class="toolbar__icon"><use xlink:href='#iconMore'></use></svg>
</div>
<div class="fn__loading fn__none">
    <img width="64px" src="/stage/loading-pure.svg"></div>
</div>
<div class="fn__flex-1 fn__none inboxDetails fn__flex-column" style="min-height: auto;background-color: var(--b3-theme-background)"></div>
<div class="fn__flex-1"></div>`;
        /// #else
        this.element.classList.add("fn__flex-column", "file-tree", "sy__inbox");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg class="block__logoicon"><use xlink:href="#iconInbox"></use></svg>${window.siyuan.languages.inbox}&nbsp;
        <span class="inboxSelectCount"></span>
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <span data-type="selectall" class="block__icon"><svg><use xlink:href="#iconUncheck"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="previous" class="block__icon b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.previousLabel}"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="next" class="block__icon b3-tooltips b3-tooltips__w" disabled="disabled" aria-label="${window.siyuan.languages.nextLabel}"><svg><use xlink:href="#iconRight"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="more" data-menu="true" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href="#iconMin"></use></svg></span>
</div>
<div class="fn__loading fn__none">
    <img width="64px" src="/stage/loading-pure.svg"></div>
</div>
<div class="fn__flex-1 fn__none inboxDetails fn__flex-column" style="min-height: auto;background-color: var(--b3-theme-background)"></div>
<div class="fn__flex-1"></div>`;
        /// #endif
        const countElement = this.element.querySelector(".inboxSelectCount");
        const detailsElement = this.element.querySelector(".inboxDetails");
        const selectAllElement = this.element.firstElementChild.querySelector('[data-type="selectall"]');
        this.element.lastElementChild.addEventListener("contextmenu", (event: MouseEvent) => {
            const itemElement = hasClosestByClassName(event.target as Element, "b3-list-item");
            if (itemElement) {
                this.more(event, itemElement);
            }
        });
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
                    getDockByType("inbox").toggleModel("inbox", false, true);
                    event.preventDefault();
                    break;
                } else if (type === "selectall") {
                    const useElement = target.querySelector("use");
                    if (useElement.getAttribute("xlink:href") === "#iconUncheck") {
                        this.element.lastElementChild.querySelectorAll(".b3-list-item").forEach(item => {
                            item.querySelector("use").setAttribute("xlink:href", "#iconCheck");
                            this.selectIds.push(item.getAttribute("data-id"));
                            this.selectIds = [...new Set(this.selectIds)];
                        });
                        useElement.setAttribute("xlink:href", "#iconCheck");
                    } else {
                        this.element.lastElementChild.querySelectorAll(".b3-list-item").forEach(item => {
                            item.querySelector("use").setAttribute("xlink:href", "#iconUncheck");
                            this.selectIds.splice(this.selectIds.indexOf(item.getAttribute("data-id")), 1);
                        });
                        useElement.setAttribute("xlink:href", "#iconUncheck");
                    }
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    break;
                } else if (type === "select") {
                    const useElement = target.querySelector("use");
                    if (useElement.getAttribute("xlink:href") === "#iconUncheck") {
                        this.selectIds.push(target.parentElement.getAttribute("data-id"));
                        this.selectIds = [...new Set(this.selectIds)];
                        useElement.setAttribute("xlink:href", "#iconCheck");
                    } else {
                        this.selectIds.splice(this.selectIds.indexOf(target.parentElement.getAttribute("data-id")), 1);
                        useElement.setAttribute("xlink:href", "#iconUncheck");
                    }
                    countElement.innerHTML = `${this.selectIds.length.toString()}/${this.pageCount.toString()}`;
                    selectAllElement.querySelector("use").setAttribute("xlink:href", this.element.lastElementChild.querySelectorAll('[*|href="#iconCheck"]').length === this.element.lastElementChild.querySelectorAll(".b3-list-item").length ? "#iconCheck" : "#iconUncheck");
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
        this.element.firstElementChild.querySelector('[data-type="selectall"]').classList.remove("fn__none");
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
        return `<div class="toolbar">
    <svg data-type="back" class="toolbar__icon"><use xlink:href="#iconLeft"></use></svg>
    <span data-type="back" class="toolbar__text fn__flex-1">${data.shorthandTitle}</span>
    ${linkHTML}
</div>
<div class="b3-typography b3-typography--default" style="padding: 0 8px 8px">
${data.shorthandContent}
</div>`;
        /// #else
        if (data.shorthandURL) {
            linkHTML = `<span class="fn__space"></span><a href="${data.shorthandURL}" target="_blank" class="block__icon block__icon--show b3-tooltips b3-tooltips__w" aria-label="${window.siyuan.languages.link}">
        <svg><use xlink:href="#iconLink"></use></svg>
    </a>`;
        }
        return `<div class="block__icons">
    <div class="block__logo fn__pointer fn__flex-1" data-type="back">
        <svg class="block__logoicon"><use xlink:href="#iconLeft"></use></svg><span class="ft__breakword">${data.shorthandTitle}</span>
    </div>
    ${linkHTML}
</div>
<div class="b3-typography b3-typography--default" style="padding: 0 8px 8px;user-select: text" data-type="textMenu">
${data.shorthandContent}
</div>`;
        /// #endif
    }

    private genItemHTML(item: IInbox) {
        return `<li style="padding-left: 0" data-id="${item.oId}" class="b3-list-item">
    <span data-type="select" class="b3-list-item__action">
        <svg><use xlink:href="#icon${this.selectIds.includes(item.oId) ? "Check" : "Uncheck"}"></use></svg> 
    </span>
    <span class="fn__space--small"></span>
    <span class="b3-list-item__text" title="${item.shorthandTitle}${item.shorthandTitle === item.shorthandDesc ? "" : "\n" + item.shorthandDesc}">${item.shorthandTitle}</span>
    <span class="b3-list-item__meta">${item.hCreated}</span>
</li>`;
    }

    private more(event: MouseEvent, itemElement?: HTMLElement) {
        const detailsElement = this.element.querySelector(".inboxDetails");
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.refresh,
            icon: "iconRefresh",
            click: () => {
                if (itemElement) {
                    fetchPost("/api/inbox/getShorthand", {
                        id: itemElement.dataset.id
                    }, (response) => {
                        this.data[response.data.oId] = response.data;
                        itemElement.outerHTML = this.genItemHTML(response.data);
                    });
                } else if (detailsElement.classList.contains("fn__none")) {
                    this.currentPage = 1;
                    this.update();
                } else {
                    fetchPost("/api/inbox/getShorthand", {
                        id: detailsElement.getAttribute("data-id")
                    }, (response) => {
                        this.data[response.data.oId] = response.data;
                        detailsElement.innerHTML = this.genDetail(response.data);
                        detailsElement.scrollTop = 0;
                    });
                }
            }
        }).element);
        let ids: string[] = [];
        if (itemElement) {
            ids = [itemElement.dataset.id];
        } else if (detailsElement.classList.contains("fn__none")) {
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
                    let removeTitle = "";
                    ids.forEach((id, index) => {
                        removeTitle += '<code class="fn__code">' + escapeHtml(this.data[id].shorthandTitle) + "</code>" + (index === ids.length - 1 ? "" : ", ");
                    });
                    confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} ${removeTitle}?`, () => {
                        if (itemElement) {
                            this.remove([itemElement.dataset.id]);
                        } else if (detailsElement.classList.contains("fn__none")) {
                            this.remove();
                        } else {
                            this.remove([detailsElement.getAttribute("data-id")]);
                        }
                    }, undefined, true);
                }
            }).element);
        }
        if (this.app.plugins) {
            emitOpenMenu({
                plugins: this.app.plugins,
                type: "open-menu-inbox",
                detail: {
                    ids,
                    element: itemElement || detailsElement,
                },
                separatorPosition: "top",
            });
        }
        window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 16});
    }

    private remove(removeIds?: string[]) {
        if (!removeIds) {
            removeIds = this.selectIds;
        }
        fetchPost("/api/inbox/removeShorthands", {ids: removeIds}, () => {
            if (removeIds) {
                this.back();
                for (let i = this.selectIds.length - 1; i >= 0; i--) {
                    if (removeIds.includes(this.selectIds[i])) {
                        this.selectIds.splice(i, 1);
                    }
                }
            } else {
                this.selectIds = [];
            }
            this.currentPage = 1;
            this.update();
        });
    }

    private move(ids: string[]) {
        movePathTo({
            cb: async (toPath, toNotebook) => {
                for (let i = 0; i < ids.length; i++) {
                    const idItem = ids[i];
                    const response = await fetchSyncPost("/api/inbox/getShorthand", {
                        id: idItem
                    });
                    this.data[response.data.oId] = response.data;
                    let md = response.data.shorthandMd;
                    if ("" === md && "" === response.data.shorthandContent && "" != response.data.shorthandURL) {
                        md = "[" + response.data.shorthandTitle + "](" + response.data.shorthandURL + ")";
                    }
                    await fetchSyncPost("/api/filetree/createDoc", {
                        notebook: toNotebook[0],
                        path: pathPosix().join(getDisplayName(toPath[0], false, true), Lute.NewNodeID() + ".sy"),
                        title: replaceFileName(response.data.shorthandTitle),
                        md,
                        listDocTree: true,
                    });
                }
                this.remove(ids);
            },
            flashcard: false
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
        ${window.siyuan.config.system.container === "ios" ? window.siyuan.languages._kernel[122] : window.siyuan.languages._kernel[29].replaceAll("${accountServer}", getCloudURL(""))}
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
                    html += this.genItemHTML(item);
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
            this.element.firstElementChild.querySelector('[data-type="selectall"] use').setAttribute("xlink:href", (this.element.lastElementChild.querySelectorAll('[*|href="#iconCheck"]').length === selectCount && selectCount !== 0) ? "#iconCheck" : "#iconUncheck");
            this.element.lastElementChild.scrollTop = 0;
        });
    }
}
