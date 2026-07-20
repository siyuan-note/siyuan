import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
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
    private updating = false;
    private updatePending = false;
    private dragoverElement: HTMLElement;
    private dragenterCounter = 0;

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "bookmark",
            msgCallback: this.handleMsgCallback.bind(this)
        });
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__bookmark", "dockPanel");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.bookmark}</div>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
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
            blockDraggable: !window.siyuan.config.readonly,
            dragStart: (element, event) => {
                const id = element.dataset.nodeId;
                if (!id) {
                    return false;
                }
                event.dataTransfer.setData(Constants.SIYUAN_DROP_BLOCK_REF, JSON.stringify({
                    ids: [id],
                    workspaceDir: window.siyuan.config.system.workspaceDir,
                }));
                event.dataTransfer.effectAllowed = "copyMove";
                element.style.opacity = "0.38";
                window.siyuan.dragElement = undefined;
                window.siyuan.dragTitle = element.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
                return true;
            },
            dragEnd: (element) => {
                element.style.opacity = "1";
                window.siyuan.dragElement = undefined;
                window.siyuan.dragTitle = "";
                this.dragenterCounter = 0;
                this.clearDropTarget();
                return true;
            },
        });
        this.bindDropEvent();
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

    private handleMsgCallback(data: IWebSocketData) {
        if (data) {
            switch (data.cmd) {
                case "transactions": {
                    let needReload = false;
                    data.data[0].doOperations.forEach((item: IOperation) => {
                        if ((item.action === "update" || item.action === "insert") && typeof item.data === "string" &&
                            item.data.indexOf('class="protyle-attr--bookmark"') > -1) {
                            needReload = true;
                        } else if (item.action === "delete") {
                            needReload = true;
                        } else if (item.action === "updateAttrs") {
                            const attrs = item.data as {
                                old?: Record<string, string>,
                                new?: Record<string, string>
                            };
                            if (attrs.old?.bookmark !== attrs.new?.bookmark) {
                                needReload = true;
                            }
                        }
                    });
                    if (needReload) {
                        this.update();
                    }
                    break;
                }
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

    public update() {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (this.updating) {
            this.updatePending = true;
            return;
        }
        this.updating = true;
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
            this.tree.element.querySelectorAll(":scope > ul > li[data-treetype=\"bookmark\"]:not([data-node-id])").forEach((item: HTMLElement, index) => {
                const bookmark = response.data[index];
                if (bookmark) {
                    item.dataset.bookmark = bookmark.name;
                }
            });
            element.classList.remove("fn__rotate");
            this.updating = false;
            if (this.updatePending) {
                this.updatePending = false;
                this.update();
            }
        });
    }

    private bindDropEvent() {
        this.tree.element.addEventListener("dragenter", (event) => {
            if (this.isSupportedDrop(event.dataTransfer)) {
                this.dragenterCounter++;
                event.preventDefault();
            }
        });
        this.tree.element.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
            if (!this.isSupportedDrop(event.dataTransfer)) {
                return;
            }
            const target = this.getDropTarget(event.target);
            if (!target) {
                this.clearDropTarget();
                return;
            }
            if (target !== this.dragoverElement) {
                this.clearDropTarget();
                target.classList.add("dragover");
                this.dragoverElement = target;
            }
            event.dataTransfer.dropEffect = event.dataTransfer.types.includes(Constants.SIYUAN_DROP_BLOCK_REF) ? "move" : "copy";
            event.preventDefault();
        });
        this.tree.element.addEventListener("dragleave", () => {
            this.dragenterCounter--;
            if (this.dragenterCounter <= 0) {
                this.dragenterCounter = 0;
                this.clearDropTarget();
            }
        });
        this.tree.element.addEventListener("drop", (event: DragEvent & { target: HTMLElement }) => {
            this.dragenterCounter = 0;
            const target = this.getDropTarget(event.target);
            this.clearDropTarget();
            if (!target || !this.isSupportedDrop(event.dataTransfer)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const ids = this.getDropBlockIds(event.dataTransfer);
            if (ids.length === 0) {
                return;
            }
            const bookmark = target.classList.contains("b3-list--empty") ?
                window.siyuan.languages.default : target.dataset.bookmark;
            if (!bookmark) {
                return;
            }
            fetchPost("/api/attr/batchSetBlockAttrs", {
                blockAttrs: ids.map(id => ({
                    id,
                    attrs: {bookmark},
                })),
            }, () => {
                this.update();
            });
        });
    }

    private isSupportedDrop(dataTransfer: DataTransfer) {
        if (window.siyuan.config.readonly) {
            return false;
        }
        if (dataTransfer.types.includes(Constants.SIYUAN_DROP_BLOCK_REF)) {
            return true;
        }
        const gutterType = Array.from(dataTransfer.types).find(type => type.startsWith(Constants.SIYUAN_DROP_GUTTER));
        if (gutterType) {
            const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
            const isAttributeViewItem = gutterTypes[0] === "nodeattributeviewrowmenu" ||
                gutterTypes[0] === "nodeattributeviewrow" ||
                (gutterTypes[0] === "nodeattributeview" && ["viewtab", "col", "galleryitem"].includes(gutterTypes[1] || ""));
            if (isAttributeViewItem || gutterTypes[0] === "nodethematicbreak") {
                return false;
            }
            if (gutterTypes[3] && gutterTypes[3] !== window.siyuan.config.system.workspaceDir.toLowerCase()) {
                return false;
            }
            return true;
        }
        return dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) ||
            dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB);
    }

    private getDropBlockIds(dataTransfer: DataTransfer) {
        const ids: string[] = [];
        if (dataTransfer.types.includes(Constants.SIYUAN_DROP_BLOCK_REF)) {
            try {
                const data = JSON.parse(dataTransfer.getData(Constants.SIYUAN_DROP_BLOCK_REF));
                if (data.workspaceDir?.toLowerCase() === window.siyuan.config.system.workspaceDir.toLowerCase() &&
                    Array.isArray(data.ids)) {
                    ids.push(...data.ids);
                }
            } catch (e) {
                console.warn("parse bookmark drop block reference data failed", e);
            }
        } else {
            const gutterType = Array.from(dataTransfer.types).find(type => type.startsWith(Constants.SIYUAN_DROP_GUTTER));
            if (gutterType) {
                const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                ids.push(...(gutterTypes[2] || "").split(","));
            } else if (dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE)) {
                ids.push(...dataTransfer.getData(Constants.SIYUAN_DROP_FILE).split(","));
            } else if (dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
                try {
                    const tabData = JSON.parse(dataTransfer.getData(Constants.SIYUAN_DROP_TAB));
                    if (tabData.children?.instance === "Editor") {
                        ids.push(tabData.children.rootId);
                    }
                } catch (e) {
                    console.warn("parse bookmark drop tab data failed", e);
                }
            }
        }
        return Array.from(new Set(ids.filter(id => typeof id === "string" && /^\d{14}-[0-9a-z]{7}$/.test(id))));
    }

    private getDropTarget(target: HTMLElement) {
        const emptyElement = this.tree.element.querySelector(".b3-list--empty") as HTMLElement;
        if (emptyElement) {
            return emptyElement;
        }
        const item = target.closest("li[data-treetype=\"bookmark\"]") as HTMLElement;
        if (!item || !this.tree.element.contains(item)) {
            return;
        }
        if (!item.dataset.nodeId) {
            return item;
        }
        let blockElement = item;
        while (blockElement?.dataset.nodeId) {
            const parentElement = blockElement.parentElement?.previousElementSibling as HTMLElement;
            if (parentElement?.dataset.treetype !== "bookmark") {
                return;
            }
            if (!parentElement.dataset.nodeId) {
                return parentElement;
            }
            blockElement = parentElement;
        }
    }

    private clearDropTarget() {
        this.dragoverElement?.classList.remove("dragover");
        this.dragoverElement = undefined;
    }
}
