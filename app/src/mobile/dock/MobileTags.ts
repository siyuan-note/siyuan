import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {MenuItem} from "../../menus/Menu";
import {popSearch} from "../menu/search";
import {App} from "../../index";
import {openTagMenu} from "../../menus/tag";
import {Constants} from "../../constants";

export class MobileTags {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];
    private preFilterOpenNodes: string[];
    private updating = false;
    private pendingUpdate: boolean;

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-tag"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.tag}
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <svg data-type="search" class="toolbar__icon"><use xlink:href='#iconFilter'></use></svg>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <span class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></span>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1 tagList"></div>
<img style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 30vw;box-sizing: border-box;" src="/stage/loading-pure.svg">`;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        inputElement.addEventListener("blur", () => {
            inputElement.classList.add("fn__none");
            const filterIconElement = inputElement.nextElementSibling as HTMLElement;
            const value = inputElement.value;
            if (value.trim()) {
                filterIconElement.classList.add("toolbar__icon--active");
            } else {
                filterIconElement.classList.remove("toolbar__icon--active");
            }
            if (inputElement.dataset.value !== value) {
                inputElement.dataset.value = value;
                this.update();
            }
        });
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event.isComposing && event.key === "Enter") {
                inputElement.dataset.value = inputElement.value;
                this.update();
            }
        });

        this.tree = new Tree({
            element: this.element.querySelector(".tagList") as HTMLElement,
            data: null,
            click: (element: HTMLElement, event?: MouseEvent) => {
                const labelName = element.getAttribute("data-label");
                if (event) {
                    const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                    if (actionElement) {
                        openTagMenu(actionElement.parentElement, event, labelName);
                        return;
                    }
                }
                popSearch(app, {
                    hasReplace: false,
                    method: 0,
                    hPath: "",
                    idPath: [],
                    k: `#${labelName}#`,
                    r: "",
                    page: 1,
                });
            },
            blockExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>'
        });
        this.element.addEventListener("click", (event) => {
            if ((event.target as HTMLElement).tagName === "INPUT") {
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("toolbar__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "collapse":
                            this.tree.collapseAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "expand":
                            this.tree.expandAll();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                        case "search":
                            inputElement.classList.remove("fn__none");
                            inputElement.select();
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
                    }
                }
                target = target.parentElement;
            }
        });
        this.update(false);
    }

    public update(ignoreMaxListHint = true) {
        if (this.updating) {
            this.pendingUpdate = ignoreMaxListHint;
            return;
        }
        this.updating = true;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keyword = inputElement.value;
        const hasKeyword = keyword.trim().length > 0;
        if (hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
            this.preFilterOpenNodes = this.tree.getExpandIds();
        }
        this.element.lastElementChild.classList.remove("fn__none");
        fetchPost("/api/tag/getTag", {
            sort: window.siyuan.config.tag.sort,
            app: Constants.SIYUAN_APPID,
            ignoreMaxListHint,
            k: keyword,
        }, response => {
            if (this.pendingUpdate !== undefined) {
                const pendingUpdate = this.pendingUpdate;
                this.pendingUpdate = undefined;
                this.updating = false;
                this.update(pendingUpdate);
                return;
            }
            if (!hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
                this.openNodes = this.tree.getExpandIds();
            }
            this.tree.updateData(response.data);
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
            this.updating = false;
            this.element.lastElementChild.classList.add("fn__none");
        });
    }
}
