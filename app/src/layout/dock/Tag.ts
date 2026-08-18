import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openGlobalSearch} from "../../search/util";
import {MenuItem} from "../../menus/Menu";
import type {App} from "../../index";
import {openTagMenu} from "../../menus/tag";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {Constants} from "../../constants";
import {filterTagData, getTagFilterKeywords} from "./tagFilter";

export class Tag extends Model {
    private openNodes: string[];
    private preFilterOpenNodes: string[];
    private data: IBlockTree[] = [];
    private filterData: IBlockTree[];
    private updating = false;
    private pendingUpdate: boolean;
    private filterLoadPending = false;
    public tree: Tree;
    private element: Element;

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "tag",
            msgCallback: this.handleMsgCallback.bind(this)
        });

        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__tag", "dockPanel");

        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.tag}</div>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="sort" class="block__icon ariaLabel${window.siyuan.config.readonly ? " fn__none" : ""}" data-position="north" aria-label="${window.siyuan.languages.sort}">
        <svg><use xlink:href="#iconSort"></use></svg>
    </span>
    <span class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></span>
    <span data-type="expand" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.expand}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1" style="margin-bottom: 8px"></div>`;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        inputElement.addEventListener("blur", () => {
            inputElement.classList.add("fn__none");
            const filterIconElement = inputElement.nextElementSibling as HTMLElement;
            const value = inputElement.value;
            if (value.trim()) {
                filterIconElement.classList.add("block__icon--active");
                filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter + " " + value);
            } else {
                filterIconElement.classList.remove("block__icon--active");
                filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter);
            }
        });
        inputElement.addEventListener("input", (event: InputEvent) => {
            if (!event.isComposing) {
                this.filter();
            }
        });
        inputElement.addEventListener("compositionend", () => this.filter());

        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click(element: HTMLElement, event?: MouseEvent) {
                const labelName = element.getAttribute("data-label");
                if (event) {
                    const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                    if (actionElement) {
                        openTagMenu(actionElement.parentElement, event, labelName);
                        return;
                    }
                }
                openGlobalSearch(app, `#${element.getAttribute("data-label")}#`, !window.siyuan.ctrlIsPressed, {method: 0});
            },
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                openTagMenu(element, event, element.getAttribute("data-label"));
            },
            blockExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>'
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
        });
        this.element.addEventListener("click", (event: MouseEvent) => {
            if ((event.target as HTMLElement).tagName === "INPUT") {
                return;
            }
            setPanelFocus(this.element);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("tag").toggleModel("tag", false, true);
                            break;
                        case "sort":
                            window.siyuan.menus.menu.remove();
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 0 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 0;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 1 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 1;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 4 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameNatASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 4;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 5 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.fileNameNatDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 5;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 7 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.refCountASC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 7;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.append(new MenuItem({
                                icon: window.siyuan.config.tag.sort === 8 ? "iconSelect" : undefined,
                                label: window.siyuan.languages.refCountDESC,
                                click: () => {
                                    window.siyuan.config.tag.sort = 8;
                                    this.update();
                                },
                            }).element);
                            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "refresh":
                            this.update();
                            break;
                        case "search":
                            inputElement.classList.remove("fn__none");
                            inputElement.select();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });
        this.update(false);
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data) {
            switch (data.cmd) {
                case "transactions":
                    data.data[0].doOperations.forEach((item: IOperation) => {
                        let needReload = false;
                        if ((item.action === "update" || item.action === "insert") && item.data.indexOf('data-type="tag"') > -1) {
                            needReload = true;
                        } else if (item.action === "delete") {
                            needReload = true;
                        }
                        if (needReload) {
                            this.update();
                        }
                    });
                    break;
                case "closeBox":
                case "removeBox":
                case "removeDoc":
                case "mount":
                    if (data.cmd !== "mount" || data.code !== 1) {
                        this.update();
                    }
                    break;
            }
        }
    }

    public update(ignoreMaxListHint = true) {
        if (this.updating) {
            this.pendingUpdate = ignoreMaxListHint;
            return;
        }
        this.updating = true;
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const ignoreMaxListHintArg = getTagFilterKeywords(inputElement.value).length > 0 || ignoreMaxListHint;
        element.classList.add("fn__rotate");
        fetchPost("/api/tag/getTag", {
            sort: window.siyuan.config.tag.sort,
            app: Constants.SIYUAN_APPID,
            ignoreMaxListHint: ignoreMaxListHintArg,
        }, response => {
            if (this.pendingUpdate !== undefined) {
                const pendingUpdate = this.pendingUpdate;
                this.pendingUpdate = undefined;
                this.updating = false;
                this.update(pendingUpdate);
                return;
            }
            this.data = response.data;
            this.filterData = ignoreMaxListHintArg ? response.data : undefined;
            this.filter();
            this.updating = false;
            element.classList.remove("fn__rotate");
            if (this.filterLoadPending) {
                this.filterLoadPending = false;
                this.loadFilterData();
            }
        });
    }

    private loadFilterData() {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        if (getTagFilterKeywords(inputElement.value).length === 0 || this.filterData) {
            this.filter();
            return;
        }
        if (this.updating) {
            this.filterLoadPending = true;
            return;
        }
        this.updating = true;
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        element.classList.add("fn__rotate");
        fetchPost("/api/tag/getTag", {
            sort: window.siyuan.config.tag.sort,
            app: Constants.SIYUAN_APPID,
            ignoreMaxListHint: true,
        }, response => {
            if (this.pendingUpdate !== undefined) {
                const pendingUpdate = this.pendingUpdate;
                this.pendingUpdate = undefined;
                this.filterLoadPending = false;
                this.updating = false;
                this.update(pendingUpdate);
                return;
            }
            this.filterData = response.data;
            this.filterLoadPending = false;
            this.filter();
            this.updating = false;
            element.classList.remove("fn__rotate");
        });
    }

    private filter() {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = getTagFilterKeywords(inputElement.value);
        const hasKeyword = keywords.length > 0;
        if (hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
            this.preFilterOpenNodes = this.tree.getExpandIds();
        } else if (!hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
            this.openNodes = this.tree.getExpandIds();
        }
        if (hasKeyword && !this.filterData) {
            this.loadFilterData();
            return;
        }
        const data = hasKeyword ? filterTagData(this.filterData, keywords) : this.data;
        this.tree.updateData(data);
        if (hasKeyword) {
            this.tree.expandAll();
        } else if (this.preFilterOpenNodes !== undefined) {
            this.tree.collapseAll();
            this.tree.setExpandIds(this.preFilterOpenNodes);
            this.openNodes = this.preFilterOpenNodes;
            this.preFilterOpenNodes = undefined;
        } else if (this.openNodes !== undefined) {
            this.tree.collapseAll();
            this.tree.setExpandIds(this.openNodes);
        } else {
            this.openNodes = this.tree.getExpandIds();
        }
    }
}
