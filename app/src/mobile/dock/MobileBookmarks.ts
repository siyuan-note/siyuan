import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openMobileFileById} from "../editor";
import {openBookmarkMenu} from "../../menus/bookmark";
import {App} from "../../index";

export class MobileBookmarks {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-bookmark"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.bookmark}
    </div>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="fn__flex-1 bookmarkList"></div>
<img style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 30vw;box-sizing: border-box;" src="/stage/loading-pure.svg">`;

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
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openMobileFileById(app, id, foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
                });
            },
            blockExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>'
        });
        this.element.addEventListener("click", (event) => {
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
                    }
                }
                target = target.parentElement;
            }
        });
        this.update();
    }

    public update() {
        this.element.lastElementChild.classList.remove("fn__none");
        fetchPost("/api/bookmark/getBookmark", {}, response => {
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
