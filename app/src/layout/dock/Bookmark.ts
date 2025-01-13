import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {openBookmarkMenu} from "../../menus/bookmark";
import {App} from "../../index";
import {Constants} from "../../constants";
import {checkFold} from "../../util/noRelyPCFunction";

export class Bookmark extends Model {
    private openNodes: string[];
    public tree: Tree;
    private element: Element;

    constructor(app: App, tab: Tab) {
        super({
            app,
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
                        case "removeDoc":
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
        <svg class="block__logoicon"><use xlink:href="#iconBookmark"></use></svg>${window.siyuan.languages.bookmark}
    </div>
    <span class="fn__flex-1"></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.expand} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1" style="margin-bottom: 8px"></div>`;
        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement, event?: MouseEvent) => {
                if (event) {
                    const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                    if (actionElement) {
                        openBookmarkMenu(actionElement.parentElement, event, this);
                        return;
                    }
                }
                const id = element.getAttribute("data-node-id");
                checkFold(id, (zoomIn, action: TProtyleAction[]) => {
                    openFileById({
                        app,
                        id,
                        action,
                        zoomIn
                    });
                });
            },
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                openBookmarkMenu(element, event, this);
            },
            ctrlClick: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                checkFold(id, (zoomIn) => {
                    openFileById({
                        app,
                        id,
                        keepCursor: true,
                        action: zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL] : [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
                        zoomIn
                    });
                });
            },
            altClick: (element: HTMLElement,) => {
                const id = element.getAttribute("data-node-id");
                checkFold(id, (zoomIn, action: TProtyleAction[]) => {
                    openFileById({
                        app,
                        id,
                        position: "bottom",
                        action,
                        zoomIn
                    });
                });
            },
            shiftClick: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                checkFold(id, (zoomIn, action: TProtyleAction[]) => {
                    openFileById({
                        app,
                        id,
                        position: "bottom",
                        action,
                        zoomIn
                    });
                });
            },
            blockExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
        });
        this.element.addEventListener("click", (event) => {
            setPanelFocus(this.element);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("bookmark").toggleModel("bookmark", false, true);
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
