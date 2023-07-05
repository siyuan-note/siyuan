import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getDockByType, getInstanceById, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {getAllModels} from "../getAll";
import {hasClosestBlock, hasClosestByClassName, hasTopClosestByClassName} from "../../protyle/util/hasClosest";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";
import {onGet} from "../../protyle/util/onGet";
import {getPreviousBlock} from "../../protyle/wysiwyg/getBlock";
import {App} from "../../index";

export class Outline extends Model {
    public tree: Tree;
    public element: HTMLElement;
    public headerElement: HTMLElement;
    public type: "pin" | "local";
    public blockId: string;
    public isPreview: boolean;
    private openNodes: { [key: string]: string[] } = {};

    constructor(options: {
        app: App,
        tab: Tab,
        blockId: string,
        type: "pin" | "local",
        isPreview: boolean
    }) {
        super({
            app: options.app,
            id: options.tab.id,
            callback() {
                if (this.type === "local") {
                    fetchPost("/api/block/checkBlockExist", {id: this.blockId}, existResponse => {
                        if (!existResponse.data) {
                            this.parent.parent.removeTab(this.parent.id);
                        }
                    });
                }
            },
            msgCallback(data) {
                if (data) {
                    switch (data.cmd) {
                        case "transactions":
                            this.onTransaction(data);
                            break;
                        case "rename":
                            if (this.type === "local" && this.blockId === data.data.id) {
                                this.parent.updateTitle(data.data.title);
                            } else {
                                this.updateDocTitle({
                                    title: data.data.title,
                                    icon: Constants.ZWSP
                                });
                            }
                            break;
                        case "unmount":
                            if (this.type === "local") {
                                fetchPost("/api/block/checkBlockExist", {id: this.blockId}, existResponse => {
                                    if (!existResponse.data) {
                                        this.parent.parent.removeTab(this.parent.id);
                                    }
                                });
                            }
                            break;
                        case "removeDoc":
                            if (data.data.ids.includes(this.blockId) && this.type === "local") {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                    }
                }
            }
        });
        this.isPreview = options.isPreview;
        this.blockId = options.blockId;
        this.type = options.type;
        options.tab.panelElement.classList.add("fn__flex-column", "file-tree", "sy__outline");
        options.tab.panelElement.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconAlignCenter"></use></svg>
        ${window.siyuan.languages.outline}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.stickOpen} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="b3-list-item fn__none"></div>
<div class="fn__flex-1" style="margin-bottom: 8px"></div>`;
        this.element = options.tab.panelElement.lastElementChild as HTMLElement;
        this.headerElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.tree = new Tree({
            element: options.tab.panelElement.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                if (this.isPreview) {
                    const headElement = document.getElementById(id);
                    if (headElement) {
                        const tabElement = hasTopClosestByClassName(headElement, "protyle");
                        if (tabElement) {
                            const tab = getInstanceById(tabElement.getAttribute("data-id")) as Tab;
                            tab.parent.switchTab(tab.headElement);
                        }
                        headElement.scrollIntoView();
                    } else {
                        openFileById({
                            app: options.app,
                            id: this.blockId,
                            mode: "preview",
                        });
                    }
                } else {
                    fetchPost("/api/attr/getBlockAttrs", {id}, (attrResponse) => {
                        openFileById({
                            app: options.app,
                            id,
                            action: attrResponse.data["heading-fold"] === "1" ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                        });
                    });
                }
            }
        });
        // 为了快捷键的 dispatch
        options.tab.panelElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        options.tab.panelElement.querySelector('[data-type="expand"]').addEventListener("click", (event: MouseEvent & {
            target: Element
        }) => {
            const iconElement = hasClosestByClassName(event.target, "block__icon");
            if (!iconElement) {
                return;
            }
            if (iconElement.classList.contains("block__icon--active")) {
                iconElement.classList.remove("block__icon--active");
            } else {
                iconElement.classList.add("block__icon--active");
            }
            this.tree.expandAll();
        });
        options.tab.panelElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (this.type === "local") {
                setPanelFocus(options.tab.panelElement.parentElement.parentElement);
            } else {
                setPanelFocus(options.tab.panelElement);
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(options.tab.panelElement)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("outline").toggleModel("outline");
                            break;
                    }
                    break;
                } else if (target.isSameNode(this.headerElement.nextElementSibling) || target.classList.contains("block__icons")) {
                    getAllModels().editor.find(item => {
                        if (this.blockId === item.editor.protyle.block.rootID) {
                            if (item.editor.protyle.scroll.element.classList.contains("fn__none")) {
                                item.editor.protyle.contentElement.scrollTop = 0;
                            } else {
                                fetchPost("/api/filetree/getDoc", {
                                    id: item.editor.protyle.block.rootID,
                                    mode: 0,
                                    size: window.siyuan.config.editor.dynamicLoadBlocks,
                                }, getResponse => {
                                    onGet({
                                        data: getResponse,
                                        protyle: item.editor.protyle,
                                        action: [Constants.CB_GET_FOCUS],
                                    });
                                });
                            }
                            return true;
                        }
                    });
                    break;
                }
                target = target.parentElement;
            }
        });

        if (this.isPreview) {
            if (this.blockId) {
                fetchPost("/api/export/preview", {
                    id: this.blockId,
                }, response => {
                    response.data = response.data.outline;
                    this.update(response);
                });
            }
        } else {
            fetchPost("/api/outline/getDocOutline", {
                id: this.blockId,
            }, response => {
                this.update(response);
            });
        }
    }

    public updateDocTitle(ial?: IObject) {
        const docTitleElement = this.headerElement.nextElementSibling as HTMLElement;
        if (this.type === "pin") {
            if (ial) {
                let iconHTML = `${unicode2Emoji(ial.icon || Constants.SIYUAN_IMAGE_FILE, "b3-list-item__graphic", true)}`;
                if (ial.icon === Constants.ZWSP && docTitleElement.firstElementChild) {
                    iconHTML = docTitleElement.firstElementChild.outerHTML;
                }
                docTitleElement.innerHTML = `${iconHTML}
<span class="b3-list-item__text">${escapeHtml(ial.title)}</span>`;
                docTitleElement.setAttribute("title", ial.title);
                docTitleElement.classList.remove("fn__none");
            } else {
                docTitleElement.classList.add("fn__none");
            }
        } else {
            docTitleElement.classList.add("fn__none");
        }
    }

    private onTransaction(data: IWebSocketData) {
        if (this.isPreview) {
            return;
        }
        let needReload = false;
        data.data[0].doOperations.forEach((item: IOperation) => {
            if ((item.action === "update" || item.action === "insert") &&
                (item.data.indexOf('data-type="NodeHeading"') > -1 || item.data.indexOf(`<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}"><wbr></div>`) > -1)) {
                needReload = true;
            } else if (item.action === "delete" || item.action === "move") {
                needReload = true;
            }
        });
        if (data.data[0].undoOperations) {
            data.data[0].undoOperations.forEach((item: IOperation) => {
                if (item.action === "update" && item.data.indexOf('data-type="NodeHeading"') > -1) {
                    needReload = true;
                }
            });
        }
        if (needReload) {
            fetchPost("/api/outline/getDocOutline", {
                id: this.blockId,
            }, response => {
                this.update(response);
                // https://github.com/siyuan-note/siyuan/issues/8372
                if (getSelection().rangeCount > 0) {
                    const blockElement = hasClosestBlock(getSelection().getRangeAt(0).startContainer);
                    if (blockElement && blockElement.getAttribute("data-type") === "NodeHeading") {
                        this.setCurrent(blockElement);
                    }
                }
            });
        }
    }

    public setCurrent(nodeElement: HTMLElement) {
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
            this.element.scrollTop = currentElement.offsetTop - this.element.clientHeight / 2 - 30;
        }
    }

    public update(data: IWebSocketData, callbackId?: string) {
        let currentElement = this.element.querySelector(".b3-list-item--focus");
        let currentId;
        if (currentElement) {
            currentId = currentElement.getAttribute("data-node-id");
        }

        if (!this.isPreview && this.openNodes[this.blockId]) {
            this.openNodes[this.blockId] = this.tree.getExpandIds();
        }
        if (typeof callbackId !== "undefined") {
            this.blockId = callbackId;
        }
        this.tree.updateData(data.data);
        if (!this.isPreview && this.openNodes[this.blockId] && !this.headerElement.querySelector('[data-type="expand"]').classList.contains("block__icon--active")) {
            this.tree.setExpandIds(this.openNodes[this.blockId]);
        } else {
            this.tree.expandAll();
            if (!this.isPreview) {
                this.openNodes[this.blockId] = this.tree.getExpandIds();
            }
        }
        if (this.isPreview) {
            this.tree.element.querySelectorAll(".popover__block").forEach(item => {
                item.classList.remove("popover__block");
            });
        }

        if (currentId) {
            currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
            if (currentElement) {
                currentElement.classList.add("b3-list-item--focus");
            }
        }
    }
}
