import {Tab} from "../Tab";
import {Model} from "../Model";
import {getDisplayName} from "../../util/pathName";
import {Tree} from "../../util/Tree";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import {getDockByType, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {getAllModels} from "../getAll";
import {onGet} from "../../protyle/util/onGet";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {MenuItem} from "../../menus/Menu";
import Protyle from "../../protyle";

export class Backlink extends Model {
    public element: HTMLElement;
    public inputsElement: NodeListOf<HTMLInputElement>;
    public type: "pin" | "local";
    public blockId: string;
    public rootId: string; // "local" 必传
    private tree: Tree;
    private notebookId: string;
    private mTree: Tree;
    private editors: Protyle[] = [];

    constructor(options: {
        tab: Tab,
        blockId: string,
        rootId?: string,
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
                if (data && this.type === "local") {
                    switch (data.cmd) {
                        case "rename":
                            if (this.blockId === data.data.id) {
                                this.parent.updateTitle(data.data.title);
                            }
                            break;
                        case "unmount":
                            if (this.notebookId === data.data.box) {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                        case "remove":
                            if (this.path?.indexOf(getDisplayName(data.data.path, false, true)) === 0) {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                    }
                }
            }
        });
        this.blockId = options.blockId;
        this.rootId = options.rootId;
        this.type = options.type;
        this.element = options.tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__backlink");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconLink"></use></svg>
        ${window.siyuan.languages.backlinks}
    </div>
    <span class="counter listCount"></span>
    <span class="fn__space"></span>
    <label class="b3-form__icon b3-form__icon--small search__label">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconFilter"></use></svg>
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="Enter ${window.siyuan.languages.filter}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse} ${updateHotkeyTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min} ${updateHotkeyTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="backlinkList fn__flex-1"></div>
<div class="block__icons">
    <div class="block__logo">
        <svg><use xlink:href="#iconLink"></use></svg>
        ${window.siyuan.languages.mentions}
    </div>
    <span class="counter listMCount"></span>
    <span class="fn__space"></span>
    <label class="b3-form__icon b3-form__icon--small search__label">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconFilter"></use></svg>
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="Enter ${window.siyuan.languages.filter}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="mCollapse" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.collapse}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="layout" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.down}">
        <svg><use xlink:href="#iconDown"></use></svg>
    </span>
</div>
<div class="backlinkMList fn__flex-1"></div>`;

        this.inputsElement = this.element.querySelectorAll("input");
        this.inputsElement.forEach((item) => {
            item.addEventListener("keydown", (event: KeyboardEvent) => {
                if (!event.isComposing && event.key === "Enter") {
                    this.searchBacklinks();
                }
            });
            item.addEventListener("input", (event: KeyboardEvent) => {
                const inputElement = event.target as HTMLInputElement;
                if (inputElement.value === "") {
                    inputElement.classList.remove("search__input--block");
                } else {
                    inputElement.classList.add("search__input--block");
                }
            });
        });
        this.tree = new Tree({
            element: this.element.querySelector(".backlinkList") as HTMLElement,
            data: null,
            click: (element) => {
                this.toggleItem(element, false);
            },
            ctrlClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    keepCursor: true,
                    action: [Constants.CB_GET_CONTEXT]
                });
            },
            altClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
            },
            shiftClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
            },
            toggleClick: (liElement) => {
                this.toggleItem(liElement, false);
            }
        });
        this.mTree = new Tree({
            element: this.element.querySelector(".backlinkMList") as HTMLElement,
            data: null,
            click: (element, event) => {
                this.toggleItem(element, true);
            },
            ctrlClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    keepCursor: true,
                    action: [Constants.CB_GET_CONTEXT]
                });
            },
            altClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
            },
            shiftClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
            },
            toggleClick: (liElement) => {
                this.toggleItem(liElement, true);
            },
            blockExtHTML: `<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>`
        });
        this.tree.element.addEventListener("scroll", () => {
            this.tree.element.querySelectorAll(".protyle-gutters").forEach(item => {
                item.classList.add("fn__none");
                item.innerHTML = "";
                // https://ld246.com/article/1651935412480
                this.tree.element.querySelectorAll(".protyle-wysiwyg--hl").forEach((hlItem) => {
                    hlItem.classList.remove("protyle-wysiwyg--hl");
                });
            });
        });
        this.mTree.element.addEventListener("scroll", () => {
            this.mTree.element.querySelectorAll(".protyle-gutters").forEach(item => {
                item.classList.add("fn__none");
                item.innerHTML = "";
                // https://ld246.com/article/1651935412480
                this.mTree.element.querySelectorAll(".protyle-wysiwyg--hl").forEach((hlItem) => {
                    hlItem.classList.remove("protyle-wysiwyg--hl");
                });
            });
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.element.querySelectorAll(".protyle").forEach(item => {
                item.classList.add("fn__none");
            });
            this.tree.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
                item.classList.remove("b3-list-item__arrow--open");
            });
        });
        this.element.addEventListener("click", (event) => {
            if (this.type === "local") {
                setPanelFocus(this.element.parentElement.parentElement);
            } else {
                setPanelFocus(this.element.firstElementChild);
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "refresh":
                            this.refresh();
                            break;
                        case "mCollapse":
                            this.mTree.element.querySelectorAll(".protyle").forEach(item => {
                                item.classList.add("fn__none");
                            });
                            this.mTree.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
                                item.classList.remove("b3-list-item__arrow--open");
                            });
                            break;
                        case "min":
                            getDockByType("backlink").toggleModel("backlink");
                            break;
                        case "layout":
                            if (this.mTree.element.style.flex) {
                                if (this.mTree.element.style.height === "0px") {
                                    this.tree.element.classList.remove("fn__none");
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
                                    this.tree.element.classList.remove("fn__none");
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.down);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconDown");
                                }
                            } else {
                                if (target.getAttribute("aria-label") === window.siyuan.languages.down) {
                                    this.tree.element.classList.remove("fn__none");
                                    this.mTree.element.setAttribute("style", "flex:none;height:0px");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
                                    this.tree.element.classList.add("fn__none");
                                    this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
                                    target.setAttribute("aria-label", window.siyuan.languages.down);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconDown");
                                }
                            }
                            target.setAttribute("data-clicked", "true");
                            break;
                    }
                }
                target = target.parentElement;
            }
        });

        this.searchBacklinks();

        if (this.type === "pin") {
            setPanelFocus(this.element.firstElementChild);
        }
    }

    private toggleItem(liElement: HTMLElement, isMention: boolean) {
        const svgElement = liElement.firstElementChild.firstElementChild;
        if (svgElement.classList.contains("b3-list-item__arrow--open")) {
            svgElement.classList.remove("b3-list-item__arrow--open");
            liElement.nextElementSibling?.classList.add("fn__none");
        } else {
            svgElement.classList.add("b3-list-item__arrow--open");
            if (liElement.nextElementSibling && liElement.nextElementSibling.tagName === "DIV") {
                liElement.nextElementSibling.classList.remove("fn__none");
            } else {
                fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                    defID: this.blockId,
                    refTreeID: liElement.getAttribute("data-node-id")
                }, (response) => {
                    const editorElement = document.createElement("div");
                    editorElement.style.minHeight = "auto";
                    liElement.after(editorElement);
                    const editor = new Protyle(editorElement, {
                        blockId: "",
                        backlinkData: isMention ? response.data.backmentions : response.data.backlinks,
                        render: {
                            background: false,
                            title: false,
                            gutter: true,
                            scroll: false,
                            breadcrumb: false,
                        }
                    });
                    this.editors.push(editor);
                });
            }
        }
    }

    public refresh() {
        fetchPost("/api/ref/refreshBacklink", {
            id: this.blockId,
        }, () => {
            this.searchBacklinks();
        });
    }

    private searchBacklinks(reload = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate") && !reload) {
            return;
        }
        element.classList.add("fn__rotate");
        fetchPost("/api/ref/getBacklink2", {
            k: this.inputsElement[0].value,
            mk: this.inputsElement[1].value,
            id: this.blockId,
        }, response => {
            this.render(response.data);
        });
    }

    public render(data: { box: string, backlinks: IBlockTree[], backmentions: IBlockTree[], linkRefsCount: number, mentionsCount: number, k: string, mk: string }) {
        if (!data) {
            data = {
                box: "",
                backlinks: [],
                backmentions: [],
                linkRefsCount: 0,
                mentionsCount: 0,
                k: "",
                mk: ""
            };
        }

        this.editors.forEach(item => {
            item.destroy();
        });
        this.editors = [];
        this.element.querySelector('.block__icon[data-type="refresh"] svg').classList.remove("fn__rotate");
        this.notebookId = data.box;
        this.inputsElement[0].value = data.k;
        this.inputsElement[1].value = data.mk;
        this.tree.updateData(data.backlinks);
        this.mTree.updateData(data.backmentions);

        const countElement = this.element.querySelector(".listCount");
        if (data.linkRefsCount === 0) {
            countElement.classList.add("fn__none");
        } else {
            countElement.classList.remove("fn__none");
            countElement.textContent = data.linkRefsCount.toString();
            this.toggleItem(this.tree.element.firstElementChild.firstElementChild as HTMLElement, false);
        }
        const mCountElement = this.element.querySelector(".listMCount");
        if (data.mentionsCount === 0) {
            mCountElement.classList.add("fn__none");
        } else {
            mCountElement.classList.remove("fn__none");
            mCountElement.textContent = data.mentionsCount.toString();
            this.toggleItem(this.mTree.element.firstElementChild.firstElementChild as HTMLElement, true);
        }

        const layoutElement = this.element.querySelector("[data-type='layout']");
        if (layoutElement.getAttribute("data-clicked")) {
            return;
        }
        if (data.mentionsCount === 0) {
            this.tree.element.classList.remove("fn__none");
            this.mTree.element.setAttribute("style", "flex:none;height:0px");
            layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
            return;
        }
        if (data.linkRefsCount === 0) {
            this.tree.element.classList.add("fn__none");
            this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
            layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
        } else {
            this.tree.element.classList.remove("fn__none");
            this.mTree.element.removeAttribute("style");
            layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
        }
    }
}
