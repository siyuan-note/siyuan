import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {openMobileFileById} from "../editor";
import {Constants} from "../../constants";
import {getEventName} from "../../protyle/util/compatibility";
import {App} from "../../index";
import {closePanel} from "../util/closePanel";
import {checkFold} from "../../util/noRelyPCFunction";
import {hasClosestBlock} from "../../protyle/util/hasClosest";
import {getPreviousBlock} from "../../protyle/wysiwyg/getBlock";

export class MobileOutline {
    private tree: Tree;
    private openNodes: { [key: string]: string[] } = {};
    private element: Element;

    constructor(app: App) {
        this.element = document.querySelector('#sidebar [data-type="sidebar-outline"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.outline}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <span class="fn__space"></span>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="fn__flex-1"></div>`;
        this.tree = new Tree({
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                if (!window.siyuan.mobile.editor.protyle.preview.element.classList.contains("fn__none")) {
                    closePanel();
                    document.getElementById(id)?.scrollIntoView();
                } else {
                    checkFold(id, (zoomIn) => {
                        openMobileFileById(app, id, zoomIn ? [Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML]);
                    });
                }
            }
        });
        this.element.firstElementChild.querySelector('[data-type="collapse"]').addEventListener(getEventName(), () => {
            this.tree.collapseAll();
        });
        const expandElement = this.element.firstElementChild.querySelector('[data-type="expand"]');
        expandElement.addEventListener(getEventName(), () => {
            if (expandElement.classList.contains("toolbar__icon--active")) {
                expandElement.classList.remove("toolbar__icon--active");
            } else {
                expandElement.classList.add("toolbar__icon--active");
            }
            this.tree.expandAll();
        });
        this.update();
    }

    public update() {
        fetchPost("/api/outline/getDocOutline", {
            id: window.siyuan.mobile.editor.protyle.block.rootID,
            preview: !window.siyuan.mobile.editor.protyle.preview.element.classList.contains("fn__none")
        }, response => {
            let currentId;
            let currentElement = this.element.querySelector(".b3-list-item--focus");
            if (currentElement) {
                currentId = currentElement.getAttribute("data-node-id");
            }

            const blockId = window.siyuan.mobile.editor.protyle.block.rootID;
            if (this.openNodes[blockId]) {
                this.openNodes[blockId] = this.tree.getExpandIds();
            }
            this.tree.updateData(response.data);
            if (this.openNodes[blockId] && !this.element.firstElementChild.querySelector('[data-type="expand"]').classList.contains("toolbar__icon--active")) {
                this.tree.setExpandIds(this.openNodes[blockId]);
            } else {
                this.tree.expandAll();
                this.openNodes[blockId] = this.tree.getExpandIds();
            }

            if (window.siyuan.mobile.editor?.protyle?.toolbar.range) {
                const blockElement = hasClosestBlock(window.siyuan.mobile.editor.protyle.toolbar.range.startContainer);
                if (blockElement) {
                    this.setCurrent(blockElement);
                    return;
                }
            }
            if (currentId) {
                currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
                if (currentElement) {
                    currentElement.classList.add("b3-list-item--focus");
                }
            }
        });
    }

    private setCurrentByPreview(nodeElement: Element) {
        if (!nodeElement) {
            return;
        }
        let previousElement = nodeElement;
        while (previousElement && !previousElement.classList.contains("b3-typography")) {
            if (["H1", "H2", "H3", "H4", "H5", "H6"].includes(previousElement.tagName)) {
                break;
            } else {
                previousElement = previousElement.previousElementSibling || previousElement.parentElement;
            }
        }
        if (previousElement.id) {
            this.setCurrentById(previousElement.id);
        }
    }

    private setCurrentById(id: string) {
        this.element.querySelectorAll(".b3-list-item.b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
        });
        let currentElement = this.element.querySelector(`.b3-list-item[data-node-id="${id}"]`) as HTMLElement;
        while (currentElement && currentElement.clientHeight === 0) {
            currentElement = currentElement.parentElement.previousElementSibling as HTMLElement;
        }
        if (currentElement) {
            currentElement.classList.add("b3-list-item--focus");
            this.tree.element.scrollTop = currentElement.offsetTop - this.element.clientHeight / 2 - 30;
        }
    }

    private setCurrent(nodeElement: HTMLElement) {
        if (!nodeElement) {
            return;
        }
        if (nodeElement.getAttribute("data-type") === "NodeHeading") {
            this.setCurrentById(nodeElement.getAttribute("data-node-id"));
        } else {
            let previousElement = getPreviousBlock(nodeElement);
            while (previousElement) {
                if (previousElement.getAttribute("data-type") === "NodeHeading") {
                    break;
                } else {
                    previousElement = getPreviousBlock(previousElement);
                }
            }
            if (previousElement) {
                this.setCurrentById(previousElement.getAttribute("data-node-id"));
            } else {
                fetchPost("/api/block/getBlockBreadcrumb", {
                    id: nodeElement.getAttribute("data-node-id"),
                    excludeTypes: []
                }, (response) => {
                    response.data.reverse().find((item: IBreadcrumb) => {
                        if (item.type === "NodeHeading") {
                            this.setCurrentById(item.id);
                            return true;
                        }
                    });
                });
            }
        }
    }
}
