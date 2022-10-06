import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openMobileFileById} from "../editor";
import {confirmDialog} from "../../dialog/confirmDialog";
import {escapeHtml} from "../../util/escape";
import {Dialog} from "../../dialog";

export class MobileBookmarks {
    public element: HTMLElement;
    private tree: Tree;
    private openNodes: string[];

    constructor() {
        this.element = document.querySelector('#sidebar [data-type="sidebar-bookmark"]');
        this.element.innerHTML = `<div class="toolbar">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.bookmark}
    </div>
    <span class="fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconFullscreen"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="fn__flex-1 bookmarkList"></div>
<img style="position: absolute;top: 0;left: 0;height: 100%;width: 100%;padding: 30vw;box-sizing: border-box;" src="/stage/loading-pure.svg">`;

        this.tree = new Tree({
            element: this.element.querySelector(".bookmarkList") as HTMLElement,
            data: null,
            click: (element: HTMLElement, event: MouseEvent) => {
                const id = element.getAttribute("data-node-id");
                const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                if (actionElement) {
                    const bookmark = (id ? element.parentElement.previousElementSibling : element).querySelector(".b3-list-item__text").textContent;
                    if (actionElement.getAttribute("data-type") === "remove") {
                        confirmDialog(window.siyuan.languages.deleteOpConfirm, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(bookmark)}</b>?`, () => {
                            if (id) {
                                fetchPost("/api/attr/setBlockAttrs", {id, attrs: {bookmark: ""}}, () => {
                                    this.update();
                                });
                                document.querySelectorAll(`.protyle-wysiwyg [data-node-id="${id}"]`).forEach((item) => {
                                    item.setAttribute("bookmark", "");
                                    const bookmarkElement = item.querySelector(".protyle-attr--bookmark");
                                    if (bookmarkElement) {
                                        bookmarkElement.remove();
                                    }
                                });
                            } else {
                                fetchPost("/api/bookmark/removeBookmark", {bookmark});
                            }
                        });
                    } else {
                        const dialog = new Dialog({
                            title: window.siyuan.languages.rename,
                            content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                            width: "80vw",
                        });
                        const btnsElement = dialog.element.querySelectorAll(".b3-button");
                        btnsElement[0].addEventListener("click", () => {
                            dialog.destroy();
                        });
                        const inputElement = dialog.element.querySelector("input");
                        dialog.bindInput(inputElement, () => {
                            (btnsElement[1] as HTMLButtonElement).click();
                        });
                        inputElement.value = bookmark;
                        inputElement.focus();
                        inputElement.select();
                        btnsElement[1].addEventListener("click", () => {
                            fetchPost("/api/bookmark/renameBookmark", {
                                oldBookmark: bookmark,
                                newBookmark: inputElement.value
                            }, () => {
                                dialog.destroy();
                            });
                        });
                    }
                } else {
                    openMobileFileById(id, [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]);
                }
            },
            blockExtHTML: '<span class="b3-list-item__action" data-type="remove"><svg><use xlink:href="#iconTrashcan"></use></svg></span>',
            topExtHTML: '<span class="b3-list-item__action" data-type="edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="b3-list-item__action" data-type="remove"><svg><use xlink:href="#iconTrashcan"></use></svg></span>'
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
