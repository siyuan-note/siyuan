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

export class Backlinks extends Model {
    public element: HTMLElement;
    public inputsElement: NodeListOf<HTMLInputElement>;
    public type: "pin" | "local";
    public blockId: string;
    public rootId: string; // "local" 必传
    private tree: Tree;
    private notebookId: string;
    private mTree: Tree;
    public beforeLen = 10;

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
                if (data) {
                    switch (data.cmd) {
                        case "rename":
                            if (this.type === "local" && this.blockId === data.data.id) {
                                this.parent.updateTitle(data.data.title);
                            }
                            break;
                        case "unmount":
                            if (this.notebookId === data.data.box && this.type === "local") {
                                this.parent.parent.removeTab(this.parent.id);
                            }
                            break;
                        case "remove":
                            if (this.path?.indexOf(getDisplayName(data.data.path, false, true)) === 0 && this.type === "local") {
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
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="Enter ${window.siyuan.languages.search}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="more" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.showMore}">
        <svg><use xlink:href="#iconAlignCenter"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.expandAll} ${updateHotkeyTip("⌘↓")}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapseAll} ${updateHotkeyTip("⌘↑")}">
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
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="Enter ${window.siyuan.languages.search}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="mExpand" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.expandAll}">
        <svg><use xlink:href="#iconFullscreen"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="mCollapse" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.collapseAll}">
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
        });

        this.tree = new Tree({
            element: this.element.querySelector(".backlinkList") as HTMLElement,
            data: null,
            click(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
            },
            ctrlClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    hasContext: true,
                    keepCursor: true,
                });
            },
            altClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
            },
            shiftClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
            }
        });
        this.mTree = new Tree({
            element: this.element.querySelector(".backlinkMList") as HTMLElement,
            data: null,
            click: (element, event) => {
                const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                if (actionElement) {
                    if (actionElement.firstElementChild.classList.contains("fn__rotate")) {
                        return;
                    }
                    window.siyuan.menus.menu.remove();
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.turnInto + " " + window.siyuan.languages.turnToStaticRef,
                        click: () => {
                            this.turnToRef(element, false);
                        }
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        label: window.siyuan.languages.turnInto + " " + window.siyuan.languages.turnToDynamicRef,
                        click: () => {
                            this.turnToRef(element, true);
                        }
                    }).element);
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                } else {
                    openFileById({
                        id: element.getAttribute("data-node-id"),
                        hasContext: true,
                        action: [Constants.CB_GET_FOCUS]
                    });
                }
            },
            ctrlClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    hasContext: true,
                    keepCursor: true,
                });
            },
            altClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
            },
            shiftClick(element: HTMLElement) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    hasContext: true,
                    action: [Constants.CB_GET_FOCUS]
                });
            },
            blockExtHTML: `<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>`
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
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
                        case "mExpand":
                            this.mTree.expandAll();
                            break;
                        case "mCollapse":
                            this.mTree.collapseAll();
                            break;
                        case "min":
                            getDockByType("backlink").toggleModel("backlink");
                            break;
                        case "more":
                            if (target.classList.contains("ft__primary")) {
                                this.searchBacklinks(this.beforeLen);
                                target.classList.remove("ft__primary");
                                target.parentElement.nextElementSibling.classList.remove("backlink--more");
                            } else {
                                this.searchBacklinks(this.beforeLen * 20);
                                target.classList.add("ft__primary");
                                target.parentElement.nextElementSibling.classList.add("backlink--more");
                            }
                            break;
                        case "layout":
                            if (this.mTree.element.style.flex) {
                                if (this.mTree.element.style.height === "0px") {
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
                                    this.mTree.element.removeAttribute("style");
                                    target.setAttribute("aria-label", window.siyuan.languages.down);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconDown");
                                }
                            } else {
                                if (target.getAttribute("aria-label") === window.siyuan.languages.down) {
                                    this.mTree.element.setAttribute("style", "flex:none;height:0px");
                                    target.setAttribute("aria-label", window.siyuan.languages.up);
                                    target.querySelector("use").setAttribute("xlink:href", "#iconUp");
                                } else {
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

    private turnToRef(element: HTMLElement, isDynamic: boolean) {
        element.querySelector(".b3-list-item__action").innerHTML = '<svg class="fn__rotate"><use xlink:href="#iconRefresh"></use></svg>';
        this.element.querySelector('.block__icon[data-type="refresh"] svg').classList.add("fn__rotate");
        fetchPost("/api/ref/createBacklink", {
            refID: element.getAttribute("data-node-id"),
            refText: decodeURIComponent(element.getAttribute("data-ref-text")),
            defID: this.blockId,
            pushMode: 0,
            isDynamic
        }, response => {
            if (response.data.defID === this.blockId) {
                this.searchBacklinks(undefined, true);
            }
            getAllModels().editor.forEach(item => {
                if (response.data.refRootID === item.editor.protyle.block.rootID) {
                    fetchPost("/api/filetree/getDoc", {
                        id: item.editor.protyle.block.id,
                        size: Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, item.editor.protyle);
                    });
                }
            });
        });
    }

    public refresh() {
        fetchPost("/api/ref/refreshBacklink", {
            id: this.blockId,
        }, () => {
            this.searchBacklinks();
        });
    }

    private searchBacklinks(beforeLength?: number, ignoreClass = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate") && !ignoreClass) {
            return;
        }
        element.classList.add("fn__rotate");
        let beforeLen;
        if (beforeLength) {
            beforeLen = beforeLength;
        } else {
            beforeLen = this.element.querySelector('.block__icon[data-type="more"]').classList.contains("ft__primary") ? this.beforeLen * 20 : this.beforeLen;
        }
        fetchPost("/api/ref/getBacklink", {
            k: this.inputsElement[0].value,
            mk: this.inputsElement[1].value,
            beforeLen,
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
        }
        const mCountElement = this.element.querySelector(".listMCount");
        if (data.mentionsCount === 0) {
            mCountElement.classList.add("fn__none");
        } else {
            mCountElement.classList.remove("fn__none");
            mCountElement.textContent = data.mentionsCount.toString();
        }

        const layoutElement = this.element.querySelector("[data-type='layout']");
        if (layoutElement.getAttribute("data-clicked")) {
            return;
        }
        if (data.mentionsCount === 0) {
            this.mTree.element.setAttribute("style", "flex:none;height:0px");
            layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
            return;
        }
        if (data.linkRefsCount === 0) {
            this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
            layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
        } else {
            this.mTree.element.removeAttribute("style");
            layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
        }
    }
}
