import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openMobileFileById} from "../editor";
import {openBookmarkMenu} from "../../menus/bookmark";
import type {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";

export class MobileBookmarks {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];
    private preFilterOpenNodes: string[];
    private data: IBlockTree[] = [];
    private updating = false;
    private updatePending = false;

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-bookmark"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.bookmark}
    </div>
    <span class="fn__space"></span>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <svg data-type="search" class="toolbar__icon"><use xlink:href='#iconFilter'></use></svg>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="fn__flex-1 bookmarkList"></div>
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
        });
        inputElement.addEventListener("input", (event: InputEvent) => {
            if (!event.isComposing) {
                this.filter();
            }
        });
        inputElement.addEventListener("compositionend", () => this.filter());

        this.tree = new Tree({
            element: this.element.querySelector(".bookmarkList") as HTMLElement,
            data: null,
            click: (element: HTMLElement, event?: MouseEvent) => {
                const id = element.getAttribute("data-node-id");
                if (event) {
                    const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                    if (actionElement) {
                        openBookmarkMenu(actionElement.parentElement, event, this);
                        return;
                    }
                }
                checkFold(id, (zoomIn) => {
                    openMobileFileById(app, id, zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                });
            },
            blockExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>'
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
                            break;
                        case "expand":
                            this.tree.expandAll();
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
        this.update();
    }

    public update() {
        if (this.updating) {
            this.updatePending = true;
            return;
        }
        this.updating = true;
        this.element.lastElementChild.classList.remove("fn__none");
        fetchPost("/api/bookmark/getBookmark", {}, response => {
            if (this.updatePending) {
                this.updatePending = false;
                this.updating = false;
                this.update();
                return;
            }
            this.data = response.data;
            this.filter();
            this.updating = false;
            this.element.lastElementChild.classList.add("fn__none");
        });
    }

    private filter() {
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        const keywords = inputElement.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const hasKeyword = keywords.length > 0;
        if (hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
            this.preFilterOpenNodes = this.tree.getExpandIds();
        } else if (!hasKeyword && this.preFilterOpenNodes === undefined && this.openNodes !== undefined) {
            this.openNodes = this.tree.getExpandIds();
        }
        const data = hasKeyword ? this.data.filter(item => {
            const name = item.name.toLowerCase();
            return keywords.every(keyword => name.includes(keyword));
        }) : this.data;
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
