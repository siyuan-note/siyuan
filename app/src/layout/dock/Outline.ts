import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getDockByType, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {getAllModels} from "../getAll";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";
import {onGet} from "../../protyle/util/onGet";

export class Outline extends Model {
    private tree: Tree;
    public element: HTMLElement;
    public headerElement: HTMLElement;
    public type: "pin" | "local";
    public blockId: string;
    private openNodes: { [key: string]: string[] } = {};

    constructor(options: {
        tab: Tab,
        blockId: string,
        type: "pin" | "local"
    }) {
        super({
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
                    }
                }
            }
        });
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
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="b3-list-item"></div>
<div class="fn__flex-1"></div>`;
        this.element = options.tab.panelElement.lastElementChild as HTMLElement;
        this.headerElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.tree = new Tree({
            element: options.tab.panelElement.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement) => {
                const id = element.getAttribute("data-node-id");
                fetchPost("/api/attr/getBlockAttrs", {id}, (attrResponse) => {
                    openFileById({
                        id,
                        action: attrResponse.data["heading-fold"] === "1" ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                    });
                });
            }
        });
        // 为了快捷键的 dispatch
        options.tab.panelElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        options.tab.panelElement.querySelector('[data-type="expand"]').addEventListener("click", (event: MouseEvent & { target: Element }) => {
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
                setPanelFocus(options.tab.panelElement.firstElementChild);
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
                                    size: Constants.SIZE_GET,
                                }, getResponse => {
                                    onGet(getResponse, item.editor.protyle, [Constants.CB_GET_FOCUS]);
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

        fetchPost("/api/outline/getDocOutline", {
            id: this.blockId,
        }, response => {
            this.update(response);
        });

        if (this.type === "pin") {
            setPanelFocus(options.tab.panelElement.firstElementChild);
        }
    }

    public updateDocTitle(ial?: IObject) {
        if (this.type === "pin") {
            if (ial) {
                let iconHTML = `<span class="b3-list-item__graphic">${unicode2Emoji(ial.icon || Constants.SIYUAN_IMAGE_FILE)}</span>`;
                if (ial.icon === Constants.ZWSP && this.headerElement.nextElementSibling.firstElementChild) {
                    iconHTML = this.headerElement.nextElementSibling.firstElementChild.outerHTML;
                }
                this.headerElement.nextElementSibling.innerHTML = `${iconHTML}
<span class="b3-list-item__text">${escapeHtml(ial.title)}</span>`;
                this.headerElement.nextElementSibling.setAttribute("title", ial.title);
            } else {
                this.headerElement.nextElementSibling.innerHTML = "";
                this.headerElement.nextElementSibling.removeAttribute("title");
            }
        }
    }

    private onTransaction(data: IWebSocketData) {
        let needReload = false;
        data.data[0].doOperations.forEach((item: IOperation) => {
            if ((item.action === "update" || item.action === "insert") &&
                (item.data.indexOf('data-type="NodeHeading"') > -1 || item.data.indexOf('<div contenteditable="true" spellcheck="false"><wbr></div>') > -1)) {
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
            });
        }
    }

    public setCurrent(id: string) {
        this.element.querySelectorAll(".b3-list-item.b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
        });
        let currentElement = this.element.querySelector(`.b3-list-item[data-node-id="${id}"]`) as HTMLElement;
        while (currentElement && currentElement.clientHeight === 0) {
            currentElement = currentElement.parentElement.previousElementSibling as HTMLElement;
        }
        if (currentElement) {
            currentElement.classList.add("b3-list-item--focus");
            const currentRect = currentElement.getBoundingClientRect();
            const scrollRect = this.element.getBoundingClientRect();
            if (currentRect.top < scrollRect.top) {
                currentElement.scrollIntoView();
            } else if (currentRect.bottom > scrollRect.bottom) {
                currentElement.scrollIntoView(false);
            }
        }
    }

    public update(data: IWebSocketData, callbackId?: string) {
        let currentElement = this.element.querySelector(".b3-list-item--focus");
        let currentId;
        if (currentElement) {
            currentId = currentElement.getAttribute("data-node-id");
        }

        if (this.openNodes[this.blockId]) {
            this.openNodes[this.blockId] = this.tree.getExpandIds();
        }
        if (typeof callbackId !== "undefined") {
            this.blockId = callbackId;
        }
        this.tree.updateData(data.data);
        if (this.openNodes[this.blockId] && !this.headerElement.querySelector('[data-type="expand"]').classList.contains("block__icon--active")) {
            this.tree.setExpandIds(this.openNodes[this.blockId]);
        } else {
            this.tree.expandAll();
            this.openNodes[this.blockId] = this.tree.getExpandIds();
        }

        if (currentId) {
            currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
            if (currentElement) {
                currentElement.classList.add("b3-list-item--focus");
            }
        }
    }
}
