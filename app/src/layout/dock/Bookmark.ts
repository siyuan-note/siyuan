import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getDockByType, setPanelFocus} from "../util";
import {MenuItem} from "../../menus/Menu";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {Dialog} from "../../dialog";
import {confirmDialog} from "../../dialog/confirmDialog";
import {escapeHtml} from "../../util/escape";

export class Bookmark extends Model {
    private openNodes: string[];
    private tree: Tree;
    private element: Element;

    constructor(tab: Tab) {
        super({
            id: tab.id,
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "transactions":
                            data.data[0].doOperations.forEach((item: IOperation) => {
                                let needReload = false;
                                if ((item.action === "update" || item.action === "insert") && item.data.indexOf('class="protyle-attr--bookmark"') > -1) {
                                    needReload = true;
                                } else if (item.action === "delete") {
                                    needReload = true;
                                }
                                if (needReload) {
                                    fetchPost("/api/bookmark/getBookmark", {}, response => {
                                        this.update(response.data);
                                    });
                                }
                            });
                            break;
                        case "unmount":
                        case "remove":
                        case "mount":
                            if (data.cmd !== "mount" || data.code !== 1) {
                                fetchPost("/api/bookmark/getBookmark", {}, response => {
                                    this.update(response.data);
                                });
                            }
                            break;
                    }
                }
            }
        });
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__bookmark");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconBookmark"></use></svg>
        ${window.siyuan.languages.bookmark}
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.expandAll} ${updateHotkeyTip("⌘↓")}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapseAll} ${updateHotkeyTip("⌘↑")}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1"></div>`;
        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click(element: HTMLElement) {
                const id = element.getAttribute("data-node-id");
                fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
                    openFileById({
                        id,
                        action: foldResponse.data ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS],
                    });
                });
            },
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                window.siyuan.menus.menu.remove();
                const id = element.getAttribute("data-node-id");
                if (!id) {
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.rename,
                        click: () => {
                            const oldBookmark = element.querySelector(".b3-list-item__text").textContent;
                            const dialog = new Dialog({
                                title: window.siyuan.languages.rename,
                                content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                                width: "520px",
                            });
                            const btnsElement = dialog.element.querySelectorAll(".b3-button");
                            btnsElement[0].addEventListener("click", () => {
                                dialog.destroy();
                            });
                            const inputElement = dialog.element.querySelector("input");
                            dialog.bindInput(inputElement, () => {
                                (btnsElement[1] as HTMLButtonElement).click();
                            });
                            inputElement.value = oldBookmark;
                            inputElement.focus();
                            inputElement.select();
                            btnsElement[1].addEventListener("click", () => {
                                fetchPost("/api/bookmark/renameBookmark", {
                                    oldBookmark,
                                    newBookmark: inputElement.value
                                }, () => {
                                    dialog.destroy();
                                });
                            });
                        }
                    }).element);
                }
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconTrashcan",
                    label: window.siyuan.languages.remove,
                    click: () => {
                        const bookmark = (id ? element.parentElement.previousElementSibling : element).querySelector(".b3-list-item__text").textContent;
                        confirmDialog(window.siyuan.languages.delete, `${window.siyuan.languages.confirmDelete} <b>${escapeHtml(bookmark)}</b>?`, () => {
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
                    }
                }).element);
                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
            },
            ctrlClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    keepCursor: true,
                });
            },
            altClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    action: [Constants.CB_GET_FOCUS]
                });
            },
            shiftClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS]
                });
            }
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
        });
        this.element.addEventListener("click", (event) => {
            setPanelFocus(this.element.firstElementChild);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("bookmark").toggleModel("bookmark");
                            break;
                        case "refresh":
                            this.update();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });

        this.update();
        setPanelFocus(this.element.firstElementChild);
    }

    public update() {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate")) {
            return;
        }
        element.classList.add("fn__rotate");
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
            element.classList.remove("fn__rotate");
        });
    }
}
