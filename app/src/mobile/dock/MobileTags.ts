import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {MenuItem} from "../../menus/Menu";
import {popSearch} from "../menu/search";
import {Constants} from "../../constants";
import {App} from "../../index";
import {openTagMenu} from "../../menus/tag";

export class MobileTags {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-tag"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.tag}
    </div>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <span class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></span>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1 tagList"></div>
<img style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 30vw;box-sizing: border-box;" src="/stage/loading-pure.svg">`;

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
                const searchOption = window.siyuan.storage[Constants.LOCAL_SEARCHDATA];
                popSearch(app, {
                    removed: searchOption.removed,
                    sort: searchOption.sort,
                    group: searchOption.group,
                    hasReplace: false,
                    method: 0,
                    hPath: "",
                    idPath: [],
                    k: `#${labelName}#`,
                    r: "",
                    page: 1,
                    types: Object.assign({}, searchOption.types)
                });
            },
            blockExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>'
        });
        this.element.addEventListener("click", (event) => {
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
        this.update();
    }

    public update() {
        this.element.lastElementChild.classList.remove("fn__none");
        fetchPost("/api/tag/getTag", {
            sort: window.siyuan.config.tag.sort
        }, response => {
            if (this.openNodes) {
                this.openNodes = this.tree.getExpandIds();
            }
            this.tree.updateData(response.data);
            if (this.openNodes) {
                this.tree.setExpandIds(this.openNodes);
            } else {
                this.openNodes = this.tree.getExpandIds();
            }
            this.element.lastElementChild.classList.add("fn__none");
        });
    }
}
