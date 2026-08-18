import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Protyle} from "../../protyle";
import {MenuItem} from "../../menus/Menu";
import type {App} from "../../index";
import {isSupportCSSHL, searchMarkRender} from "../../protyle/render/searchMarkRender";
import {getDocDisplayName, isEncryptedBox} from "../../util/pathName";
import {getAllModels} from "../getAll";
import {hideElements} from "../../protyle/ui/hideElements";
import {renderBacklink} from "../../protyle/wysiwyg/renderBacklink";
import {
    getBottomBacklinkVisibility,
    getInitialBacklinkSectionState,
    shouldDeferBottomBacklinkRefresh,
    shouldRefreshAllBacklinkContexts,
    shouldRenderBacklinkResponse,
    shouldSaveBacklinkStatus
} from "./backlinkRefresh";
import {
    cancelHeightAnimation,
    collapseHeight,
    expandHeight,
    isHeightAnimating
} from "../../util/heightAnimation";

interface IBacklinkItemRecord {
    revision: string,
    containerElement: HTMLDivElement,
    headerElement: HTMLLIElement,
    editor?: Protyle,
    contextRevision?: string,
    contextDirty?: boolean,
    requestGeneration: number,
}

interface IBacklinkIndexChange {
    rootIDs?: string[],
    backlinkChanged?: boolean,
    backlinkFull?: boolean,
}

interface IBacklinkListResponse {
    unchanged?: boolean,
    revision?: string,
    box: string,
    backlinks: IBlockTree[],
    backmentions: IBlockTree[],
    linkRefsCount: number,
    mentionsCount: number,
    k: string,
    mk: string
}

interface IBacklinkScrollAnchor {
    rootID: string,
    isMention: boolean,
    offset: number,
    scrollElement: HTMLElement,
}

export class Backlink extends Model {
    public element: HTMLElement;
    public inputsElement: NodeListOf<HTMLInputElement>;
    public type: "pin" | "local" | "bottom";
    public blockId: string;
    public rootId: string; // "local" 和 "bottom" 必传
    public ownerProtyle?: IProtyle;
    public tree: Tree;
    public notebookId: string;
    public mTree: Tree;
    public editors: Protyle[] = [];
    public status: {
        [key: string]: {
            sort: number,
            mSort: number,
            scrollTop: number,
            mScrollTop: number,
            backlinkOpenIds: string[],
            backlinkMOpenIds: string[],
            backlinkMStatus: number, // 0 全展开，1 展开一半箭头向下，2 展开一半箭头向上，3 全收起
            backlinkFolded: boolean,
            backmentionFolded: boolean
        }
    } = {};
    private dirty = false;
    private destroyed = false;
    private refreshQueued = false;
    private searchQueued = false;
    private requestID = 0;
    private requesting = false;
    private showingLoading = false;
    private contextRequestVersions = [0, 0];
    private itemRecords = [new Map<string, IBacklinkItemRecord>(), new Map<string, IBacklinkItemRecord>()];
    private listRevision = "";
    private listQueryKey = "";
    private indexChangeVersion = 0;
    private pendingRootIDs = new Set<string>();
    private pendingFull = false;
    private ownerFocusoutListener?: (event: FocusEvent) => void;
    private panelFocusoutListener?: () => void;
    private visibilityObserver?: IntersectionObserver;
    private empty = false;
    private emptyChange?: (empty: boolean) => void;

    constructor(options: {
        app: App,
        tab?: Tab,
        element?: HTMLElement,
        blockId: string,
        rootId?: string,
        notebookId?: string,
        type: "pin" | "local" | "bottom",
        ownerProtyle?: IProtyle,
        emptyChange?: (empty: boolean) => void,
    }) {
        super({app: options.app});

        if (options.type !== "bottom") {
            this.connect({
                id: options.tab.id,
                type: "backlink",
                callback: this.handelCallback.bind(this),
                msgCallback: this.handleMsgCallback.bind(this),
            });
        }

        this.blockId = options.blockId;
        this.rootId = options.rootId;
        this.notebookId = options.notebookId || "";
        this.type = options.type;
        this.ownerProtyle = options.ownerProtyle;
        this.emptyChange = options.emptyChange;
        this.element = options.element || options.tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__backlink", "dockPanel");
        this.panelFocusoutListener = () => {
            window.setTimeout(() => {
                if (this.dirty && !this.element.contains(document.activeElement)) {
                    this.refreshAfterIndex();
                }
            });
        };
        this.element.addEventListener("focusout", this.panelFocusoutListener);
        if (this.type !== "bottom") {
            this.visibilityObserver = new IntersectionObserver((entries) => {
                if (entries[0].isIntersecting) {
                    this.refreshAfterIndex();
                }
            });
            this.visibilityObserver.observe(this.element);
        }
        if (this.type === "bottom") {
            this.element.classList.add("sy__backlink--bottom");
            this.element.tabIndex = -1;
            this.ownerFocusoutListener = (event: FocusEvent) => {
                if (!event.relatedTarget || !this.ownerProtyle.element.contains(event.relatedTarget as Node)) {
                    this.refreshIfVisible(true);
                }
            };
            this.ownerProtyle.element.addEventListener("focusout", this.ownerFocusoutListener);
        }
        const backlinkSort = window.siyuan.config.editor.backlinkSort;
        const backmentionSort = window.siyuan.config.editor.backmentionSort;
        this.element.innerHTML = `<div class="block__icons backlinkList__header">
    ${this.type === "bottom" ? `<span data-type="bLayout" class="block__icon block__icon--show fn__flex-center backlinkList__toggle ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}"><svg><use xlink:href="#iconDown"></use></svg></span>` : ""}
    <div class="block__logo block__logo--counter fn__flex-1 fn__pointer" data-type="backlink">${window.siyuan.languages.backlinks}<span class="counter listCount"></span></div>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    ${this.type === "bottom" ? "" : `<span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>`}
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="sort" data-sort="${backlinkSort}" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.sort}"><svg><use xlink:href='#iconSort'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.expand}${this.type === "bottom" ? "" : updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}${this.type === "bottom" ? "" : updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type !== "pin" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type !== "pin" ? "fn__none " : ""}block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="backlinkList fn__flex-1"></div>
<div class="block__icons backlinkMList__header">
    ${this.type === "bottom" ? `<span data-type="layout" class="block__icon block__icon--show fn__flex-center backlinkList__toggle ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}"><svg><use xlink:href="#iconDown"></use></svg></span>` : ""}
    <div class="block__logo block__logo--counter fn__flex-1 fn__pointer" data-type="mention">${window.siyuan.languages.mentions}<span class="counter listMCount"></span></div>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <span data-type="search" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="mSort" data-sort="${backmentionSort}" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.sort}"><svg><use xlink:href='#iconSort'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="mExpand" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.expand}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="mCollapse" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.collapse}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    ${this.type === "bottom" ? "" : `<span class="fn__space"></span>
    <span data-type="layout" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.down}">
        <svg><use xlink:href="#iconDown"></use></svg>
    </span>`}
</div>
<div class="backlinkMList fn__flex-1"></div>`;

        this.inputsElement = this.element.querySelectorAll("input");
        this.inputsElement.forEach((item) => {
            item.addEventListener("blur", (event: KeyboardEvent) => {
                const inputElement = event.target as HTMLInputElement;
                inputElement.classList.add("fn__none");
                const filterIconElement = inputElement.parentElement.querySelector('[data-type="search"]');
                if (inputElement.value) {
                    filterIconElement.classList.add("block__icon--active");
                    filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter + " " + inputElement.value);
                } else {
                    filterIconElement.classList.remove("block__icon--active");
                    filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter);
                }
            });
            item.addEventListener("keydown", (event: KeyboardEvent) => {
                if (!event.isComposing && event.key === "Enter") {
                    this.searchBacklinks();
                }
            });
        });
        this.element.querySelectorAll('[data-type="search"]').forEach((item, index) => {
            item.addEventListener("click", (event) => {
                event.stopPropagation();
                const inputElement = this.inputsElement[index];
                inputElement.classList.remove("fn__none");
                inputElement.select();
            });
        });
        this.tree = new Tree({
            element: this.element.querySelector(".backlinkList") as HTMLElement,
            data: null,
            titleTooltipPosition: this.type === "bottom" ? "north" : "parentE",
            click: (element) => {
                this.toggleItem(element, false);
                this.setFocus();
                this.mTree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            ctrlClick: (element) => {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    action: [Constants.CB_GET_CONTEXT]
                });
                this.mTree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            altClick(element) {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
                this.mTree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            shiftClick(element) {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
                this.mTree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            toggleClick: (liElement) => {
                this.toggleItem(liElement, false);
                this.setFocus();
                this.mTree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            }
        });
        this.mTree = new Tree({
            element: this.element.querySelector(".backlinkMList") as HTMLElement,
            data: null,
            titleTooltipPosition: this.type === "bottom" ? "north" : "parentE",
            click: (element) => {
                this.toggleItem(element, true);
                this.setFocus();
                this.tree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            ctrlClick(element) {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    action: [Constants.CB_GET_CONTEXT]
                });
                this.tree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            altClick(element) {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    position: "right",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
                this.tree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            shiftClick(element) {
                openFileById({
                    app: options.app,
                    id: element.getAttribute("data-node-id"),
                    position: "bottom",
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT]
                });
                this.tree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            toggleClick: (liElement) => {
                this.toggleItem(liElement, true);
                this.setFocus();
                this.tree.element.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
            },
            blockExtHTML: `<span class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}"><svg><use xlink:href="#iconMore"></use></svg></span>`
        });
        this.tree.element.addEventListener("scroll", () => {
            this.tree.element.querySelectorAll(".protyle-gutters").forEach(item => {
                item.classList.add("fn__none");
                item.innerHTML = "";
            });
            this.tree.element.querySelectorAll(".protyle-wysiwyg--hl").forEach((hlItem) => {
                hlItem.classList.remove("protyle-wysiwyg--hl");
            });
        });
        this.mTree.element.addEventListener("scroll", () => {
            this.mTree.element.querySelectorAll(".protyle-gutters").forEach(item => {
                item.classList.add("fn__none");
                item.innerHTML = "";
            });
            this.mTree.element.querySelectorAll(".protyle-wysiwyg--hl").forEach((hlItem) => {
                hlItem.classList.remove("protyle-wysiwyg--hl");
            });
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.cancelContextRequests(this.tree.element, false);
            this.hideEditorGutters(this.tree.element);
            this.tree.element.querySelectorAll(".protyle").forEach(item => {
                item.classList.add("fn__none");
            });
            this.tree.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
                item.classList.remove("b3-list-item__arrow--open");
            });
            this.updateBottomBacklinkSpacing();
        });
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.expandDocumentItems(this.tree, false);
        });
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const eventProtyleElement = target.closest(".protyle");
            if (this.type !== "bottom" || !eventProtyleElement || !this.element.contains(eventProtyleElement)) {
                this.setFocus();
            }
            while (target && !target.isEqualNode(this.element)) {
                if ((target.classList.contains("block__icon") || target.classList.contains("block__logo")) &&
                    target.parentElement.parentElement === this.element) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "refresh":
                            this.refresh();
                            event.stopPropagation();
                            break;
                        case "mExpand":
                            this.expandDocumentItems(this.mTree, true);
                            event.stopPropagation();
                            break;
                        case "mCollapse":
                            this.cancelContextRequests(this.mTree.element, true);
                            this.hideEditorGutters(this.mTree.element);
                            this.mTree.element.querySelectorAll(".protyle").forEach(item => {
                                item.classList.add("fn__none");
                            });
                            this.mTree.element.querySelectorAll(".b3-list-item__arrow").forEach(item => {
                                item.classList.remove("b3-list-item__arrow--open");
                            });
                            event.stopPropagation();
                            break;
                        case "min":
                            getDockByType("backlink").toggleModel("backlink", false, true);
                            event.stopPropagation();
                            break;
                        case "sort":
                        case "mSort":
                            this.showSortMenu(type, target.getAttribute("data-sort"));
                            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                            event.stopPropagation();
                            break;
                        case "layout":
                            if (this.type === "bottom") {
                                this.setBottomLayout(target, this.mTree.element);
                            } else {
                                this.setLayout(target);
                            }
                            event.stopPropagation();
                            break;
                        case "bLayout":
                            this.setBottomLayout(target, this.tree.element);
                            event.stopPropagation();
                            break;
                        case "backlink":
                            if (this.type === "bottom") {
                                this.setBottomLayout(target.parentElement.querySelector('[data-type="bLayout"]'), this.tree.element);
                            } else {
                                this.setDockSectionLayout(this.tree.element);
                            }
                            event.stopPropagation();
                            break;
                        case "mention":
                            if (this.type === "bottom") {
                                this.setBottomLayout(target.parentElement.querySelector('[data-type="layout"]'), this.mTree.element);
                            } else {
                                this.setDockSectionLayout(this.mTree.element);
                            }
                            event.stopPropagation();
                            break;
                    }
                }
                target = target.parentElement;
            }
        });

        this.showBottomLoading();
        this.searchBacklinks(true);
    }

    private handelCallback() {
        if (this.type === "local") {
            fetchPost("/api/block/checkBlockExist", {id: this.blockId}, existResponse => {
                if (!existResponse.data) {
                    this.parent.parent.removeTab(this.parent.id);
                }
            });
        }
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data && this.type === "local") {
            switch (data.cmd) {
                case "rename":
                    if (this.rootId === data.data.id) {
                        this.parent.updateTitle(getDocDisplayName(data.data.title, data.data.empty));
                    }
                    break;
                case "closeBox":
                case "removeBox":
                    if (this.notebookId === data.data.box && this.type === "local") {
                        this.parent.parent.removeTab(this.parent.id);
                    }
                    break;
                case "removeDoc":
                    if (data.data.ids.includes(this.rootId) && this.type === "local") {
                        this.parent.parent.removeTab(this.parent.id);
                    }
                    break;
            }
        }
    }

    private setLayout(element: HTMLElement) {
        if (this.mTree.element.style.flex) {
            if (this.mTree.element.style.height === "0px") {
                this.tree.element.classList.remove("fn__none");
                this.mTree.element.removeAttribute("style");
                element.setAttribute("aria-label", window.siyuan.languages.up);
                element.querySelector("use").setAttribute("xlink:href", "#iconUp");
            } else {
                this.tree.element.classList.remove("fn__none");
                this.mTree.element.removeAttribute("style");
                element.setAttribute("aria-label", window.siyuan.languages.down);
                element.querySelector("use").setAttribute("xlink:href", "#iconDown");
            }
        } else {
            if (element.getAttribute("aria-label") === window.siyuan.languages.down) {
                this.tree.element.classList.remove("fn__none");
                this.mTree.element.setAttribute("style", "flex:none;height:0px");
                element.setAttribute("aria-label", window.siyuan.languages.up);
                element.querySelector("use").setAttribute("xlink:href", "#iconUp");
            } else {
                this.tree.element.classList.add("fn__none");
                this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
                element.setAttribute("aria-label", window.siyuan.languages.down);
                element.querySelector("use").setAttribute("xlink:href", "#iconDown");
            }
        }
        this.tree.element.dispatchEvent(new CustomEvent("scroll"));
        this.mTree.element.dispatchEvent(new CustomEvent("scroll"));
    }

    private setDockSectionLayout(listElement: HTMLElement) {
        const isMention = listElement === this.mTree.element;
        const backlinkFolded = this.tree.element.classList.contains("fn__none");
        const backmentionFolded = this.mTree.element.style.height === "0px";
        this.applyDockLayout(
            isMention ? backlinkFolded : !backlinkFolded,
            isMention ? !backmentionFolded : backmentionFolded,
            this.status[this.blockId]?.backlinkMStatus ?? 1,
        );
        this.saveStatus();
        this.tree.element.dispatchEvent(new CustomEvent("scroll"));
        this.mTree.element.dispatchEvent(new CustomEvent("scroll"));
    }

    private setBottomLayout(element: HTMLElement, listElement: HTMLElement) {
        if (isHeightAnimating(listElement)) {
            return;
        }
        const folded = !listElement.classList.contains("fn__none");
        if (folded) {
            this.cancelContextRequests(listElement, listElement === this.mTree.element);
            this.hideEditorGutters(listElement);
            listElement.dataset.heightFolding = "true";
            collapseHeight(listElement, () => {
                delete listElement.dataset.heightFolding;
                listElement.classList.add("fn__none");
            });
        } else {
            delete listElement.dataset.heightFolding;
            listElement.classList.remove("fn__none");
            expandHeight(listElement);
        }
        if (folded) {
            listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
        }
        element.setAttribute("aria-label", folded ? window.siyuan.languages.expand : window.siyuan.languages.collapse);
        element.querySelector("use").setAttribute("xlink:href", folded ? "#iconRight" : "#iconDown");
        this.saveStatus();
    }

    private setFocus() {
        if (this.type === "bottom") {
            this.setOwnerFocus();
            this.element.focus({preventScroll: true});
            return;
        }
        if (this.type === "local") {
            setPanelFocus(this.element.parentElement.parentElement);
        } else {
            setPanelFocus(this.element);
        }
    }

    private setOwnerFocus() {
        const wndElement = this.ownerProtyle.element.closest('[data-type="wnd"]');
        if (wndElement) {
            setPanelFocus(wndElement);
        }
    }

    private showSortMenu(type: string, sort: string) {
        const clickEvent = (currentSort: string) => {
            (type === "sort" ? this.tree : this.mTree).element.previousElementSibling.querySelector(`[data-type="${type}"]`).setAttribute("data-sort", currentSort);
            // 保存排序状态到配置
            const sortValue = parseInt(currentSort);
            if (type === "sort") {
                window.siyuan.config.editor.backlinkSort = sortValue;
            } else {
                window.siyuan.config.editor.backmentionSort = sortValue;
            }
            fetchPost("/api/setting/setEditor", window.siyuan.config.editor, (response) => {
                window.siyuan.config.editor = response.data;
            });
            this.searchBacklinks();
        };
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "0",
            iconHTML: "",
            label: window.siyuan.languages.fileNameASC,
            click: () => {
                clickEvent("0");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "1",
            iconHTML: "",
            label: window.siyuan.languages.fileNameDESC,
            click: () => {
                clickEvent("1");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "4",
            iconHTML: "",
            label: window.siyuan.languages.fileNameNatASC,
            click: () => {
                clickEvent("4");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "5",
            iconHTML: "",
            label: window.siyuan.languages.fileNameNatDESC,
            click: () => {
                clickEvent("5");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "9",
            iconHTML: "",
            label: window.siyuan.languages.createdASC,
            click: () => {
                clickEvent("9");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "10",
            iconHTML: "",
            label: window.siyuan.languages.createdDESC,
            click: () => {
                clickEvent("10");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "2",
            iconHTML: "",
            label: window.siyuan.languages.modifiedASC,
            click: () => {
                clickEvent("2");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            checked: sort === "3",
            iconHTML: "",
            label: window.siyuan.languages.modifiedDESC,
            click: () => {
                clickEvent("3");
            }
        }).element);
    }

    private toggleItem(liElement: HTMLElement, isMention: boolean) {
        const svgElement = liElement.firstElementChild?.firstElementChild;
        if (!svgElement || svgElement.getAttribute("disabled")) {
            return;
        }
        const docId = liElement.getAttribute("data-node-id");
        const record = this.itemRecords[isMention ? 1 : 0].get(docId);
        const editor = record?.editor;
        if (svgElement.classList.contains("b3-list-item__arrow--open")) {
            svgElement.classList.remove("b3-list-item__arrow--open");
            if (record) {
                record.requestGeneration++;
            }
            if (editor && this.type === "bottom") {
                hideElements(["gutter"], editor.protyle);
                editor.protyle.element.classList.add("fn__none");
            } else if (editor) {
                editor.destroy();
                this.editors.splice(this.editors.indexOf(editor), 1);
                editor.protyle.element.remove();
                if (record) {
                    record.editor = undefined;
                    record.contextRevision = "";
                }
            }
            this.updateBottomBacklinkSpacing();
        } else if (editor && !record?.contextDirty) {
            editor.protyle.element.classList.remove("fn__none");
            svgElement.classList.add("b3-list-item__arrow--open");
            this.updateBottomBacklinkSpacing();
        } else {
            this.loadContext(liElement, isMention, true);
        }
    }

    private expandDocumentItems(tree: Tree, isMention: boolean) {
        const listElement = tree.element;
        if (this.type === "bottom" && isHeightAnimating(listElement)) {
            return;
        }
        const folded = this.type === "bottom" ?
            listElement.classList.contains("fn__none") :
            (isMention ? listElement.style.height === "0px" : listElement.classList.contains("fn__none"));
        if (folded) {
            if (this.type === "bottom") {
                const toggleType = isMention ? "layout" : "bLayout";
                this.setBottomLayout(
                    listElement.previousElementSibling.querySelector(`[data-type="${toggleType}"]`),
                    listElement
                );
            } else {
                this.setDockSectionLayout(listElement);
            }
        }
        this.getDocumentItemElements(tree).forEach(item => {
            if (!item.querySelector(".b3-list-item__arrow--open")) {
                this.toggleItem(item, isMention);
            }
        });
    }

    private loadContext(liElement: HTMLElement, isMention: boolean, expand: boolean) {
        const index = isMention ? 1 : 0;
        const docId = liElement.getAttribute("data-node-id");
        const record = this.itemRecords[index].get(docId);
        const svgElement = liElement.firstElementChild?.firstElementChild;
        if (!record || !svgElement) {
            return;
        }
        svgElement.setAttribute("disabled", "disabled");
        const keyword = isMention ? this.inputsElement[1].value : this.inputsElement[0].value;
        const blockId = this.blockId;
        const contextRequestVersion = this.contextRequestVersions[index];
        const requestGeneration = ++record.requestGeneration;
        const param: IObject = {
            defID: blockId,
            refTreeID: docId,
            highlight: !isSupportCSSHL(),
            keyword,
        };
        const notebookId = liElement.getAttribute("data-notebook-id");
        if (isEncryptedBox(notebookId)) {
            param.notebook = notebookId;
        }
        if (record.contextRevision) {
            param.knownRevision = record.contextRevision;
        }
        fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", param, (response) => {
            if (this.destroyed || blockId !== this.blockId || !liElement.isConnected ||
                contextRequestVersion !== this.contextRequestVersions[index] ||
                requestGeneration !== record.requestGeneration) {
                return;
            }
            if (!response.data) {
                return;
            }
            svgElement.removeAttribute("disabled");
            record.contextDirty = false;
            record.contextRevision = response.data.revision;
            record.editor?.protyle.element.setAttribute("data-backlink-revision", response.data.revision);
            if (!response.data.unchanged) {
                const backlinkData = isMention ? response.data.backmentions : response.data.backlinks;
                if (record.editor) {
                    const scrollAnchor = this.captureScrollAnchor(this.type === "bottom" ? undefined : (isMention ? this.mTree : this.tree));
                    record.editor.protyle.options.backlinkData = backlinkData;
                    renderBacklink(record.editor.protyle, backlinkData);
                    searchMarkRender(record.editor.protyle, response.data.keywords);
                    this.restoreScrollAnchor(scrollAnchor);
                } else {
                    const editorElement = document.createElement("div");
                    editorElement.style.minHeight = "auto";
                    editorElement.setAttribute("data-defid", blockId);
                    editorElement.setAttribute("data-ismention", isMention ? "true" : "false");
                    editorElement.setAttribute("data-backlink-revision", response.data.revision);
                    record.containerElement.appendChild(editorElement);
                    const editor = new Protyle(this.app, editorElement, {
                        blockId: docId,
                        click: {
                            preventInsetEmptyBlock: true
                        },
                        backlinkData,
                        render: {
                            background: false,
                            gutter: true,
                            scroll: false,
                            breadcrumb: false,
                        }
                    });
                    if (this.type === "bottom") {
                        editor.protyle.wysiwyg.element.addEventListener("focusin", () => this.setOwnerFocus());
                    }
                    editor.protyle.notebookId = notebookId;
                    if (notebookId) {
                        editor.protyle.element.setAttribute("data-notebook-id", notebookId);
                    } else {
                        editor.protyle.element.removeAttribute("data-notebook-id");
                    }
                    searchMarkRender(editor.protyle, response.data.keywords);
                    this.editors.push(editor);
                    record.editor = editor;
                }
            }
            if (expand) {
                record.editor?.protyle.element.classList.remove("fn__none");
                svgElement.classList.add("b3-list-item__arrow--open");
            }
            this.updateBottomBacklinkSpacing();
        }).finally(() => {
            if (requestGeneration === record.requestGeneration) {
                svgElement.removeAttribute("disabled");
            }
        });
    }

    private hideEditorGutters(element: Element) {
        this.editors.forEach(editor => {
            if (editor.protyle.element === element || element.contains(editor.protyle.element)) {
                hideElements(["gutter"], editor.protyle);
            }
        });
    }

    private cancelContextRequests(element: Element, isMention: boolean) {
        this.contextRequestVersions[isMention ? 1 : 0]++;
        element.querySelectorAll(".b3-list-item__arrow[disabled]").forEach(item => {
            item.removeAttribute("disabled");
        });
    }

    private destroyItemRecord(record: IBacklinkItemRecord) {
        if (record.editor) {
            record.editor.destroy();
            const editorIndex = this.editors.indexOf(record.editor);
            if (editorIndex > -1) {
                this.editors.splice(editorIndex, 1);
            }
        }
        record.containerElement.remove();
    }

    public getDocumentItemElements(tree: Tree) {
        return Array.from(tree.element.querySelectorAll(
            ":scope > .b3-list > .backlinkList__item > .b3-list-item[data-node-id]"
        )) as HTMLLIElement[];
    }

    public getScrollElement(tree: Tree) {
        return this.type === "bottom" ? this.ownerProtyle.contentElement : tree.element;
    }

    private ensureListElement(tree: Tree) {
        let listElement = tree.element.querySelector(":scope > .b3-list") as HTMLUListElement;
        if (!listElement) {
            tree.element.replaceChildren();
            listElement = document.createElement("ul");
            listElement.className = "b3-list b3-list--background";
            tree.element.appendChild(listElement);
        }
        return listElement;
    }

    private reconcileList(tree: Tree, data: IBlockTree[], isMention: boolean) {
        let changed = false;
        const records = this.itemRecords[isMention ? 1 : 0];
        const ids = new Set(data.map(item => item.id).filter((id): id is string => Boolean(id)));
        records.forEach((record, id) => {
            if (!ids.has(id)) {
                this.destroyItemRecord(record);
                records.delete(id);
                changed = true;
            }
        });

        const listElement = this.ensureListElement(tree);
        if (data.length === 0) {
            if (!listElement.querySelector(":scope > .b3-list--empty")) {
                const emptyElement = document.createElement("li");
                emptyElement.className = "b3-list--empty";
                emptyElement.textContent = window.siyuan.languages.emptyContent;
                listElement.replaceChildren(emptyElement);
                changed = true;
            }
            return changed;
        }
        const emptyElement = listElement.querySelector(":scope > .b3-list--empty");
        if (emptyElement) {
            emptyElement.remove();
            changed = true;
        }

        const orderedRecords: IBacklinkItemRecord[] = [];
        data.forEach(item => {
            const id = item.id;
            if (!id) {
                return;
            }
            let record = records.get(id);
            if (!record) {
                const headerElement = tree.createTopLevelItem(item);
                const containerElement = document.createElement("div");
                containerElement.className = "backlinkList__item";
                containerElement.dataset.nodeId = id;
                containerElement.appendChild(headerElement);
                record = {
                    revision: item.revision || "",
                    containerElement,
                    headerElement,
                    requestGeneration: 0,
                };
                records.set(id, record);
                listElement.appendChild(containerElement);
                changed = true;
            } else if (!item.revision || record.revision !== item.revision) {
                const headerElement = tree.createTopLevelItem(item);
                const oldArrow = record.headerElement.querySelector(".b3-list-item__arrow");
                const newArrow = headerElement.querySelector(".b3-list-item__arrow");
                if (oldArrow?.classList.contains("b3-list-item__arrow--open")) {
                    newArrow?.classList.add("b3-list-item__arrow--open");
                }
                if (record.headerElement.classList.contains("b3-list-item--focus")) {
                    headerElement.classList.add("b3-list-item--focus");
                }
                record.headerElement.replaceWith(headerElement);
                record.headerElement = headerElement;
                record.revision = item.revision || "";
                changed = true;
            }
            orderedRecords.push(record);
        });

        let cursor = listElement.firstElementChild;
        orderedRecords.forEach(record => {
            if (record.containerElement !== cursor) {
                listElement.insertBefore(record.containerElement, cursor);
                changed = true;
            }
            cursor = record.containerElement.nextElementSibling;
        });
        return changed;
    }

    private captureScrollAnchor(tree?: Tree): IBacklinkScrollAnchor | undefined {
        const scrollElement = this.type === "bottom" ? this.ownerProtyle.contentElement : tree.element;
        const scopeElement = tree?.element || this.element;
        const scrollRect = scrollElement.getBoundingClientRect();
        const itemElements = Array.from(
            scopeElement.querySelectorAll(".b3-list > .backlinkList__item[data-node-id]")
        ) as HTMLElement[];
        const anchorElement = itemElements.find(item => item.getBoundingClientRect().bottom >= scrollRect.top);
        if (!anchorElement) {
            return;
        }
        return {
            rootID: anchorElement.getAttribute("data-node-id"),
            isMention: this.mTree.element.contains(anchorElement),
            offset: anchorElement.getBoundingClientRect().top - scrollRect.top,
            scrollElement,
        };
    }

    private restoreScrollAnchor(anchor?: IBacklinkScrollAnchor) {
        if (!anchor) {
            return;
        }
        const tree = anchor.isMention ? this.mTree : this.tree;
        const anchorElement = tree.element.querySelector(`.backlinkList__item[data-node-id="${anchor.rootID}"]`);
        if (!anchorElement) {
            return;
        }
        const offset = anchorElement.getBoundingClientRect().top - anchor.scrollElement.getBoundingClientRect().top;
        anchor.scrollElement.scrollTop += offset - anchor.offset;
    }

    private refreshExpandedContexts(rootIDs: Set<string>, full: boolean) {
        this.itemRecords.forEach((records, index) => {
            records.forEach((record, rootID) => {
                const arrowElement = record.headerElement.querySelector(".b3-list-item__arrow");
                if (!arrowElement?.classList.contains("b3-list-item__arrow--open")) {
                    if (full || rootIDs.has(rootID)) {
                        record.contextDirty = true;
                    }
                    return;
                }
                if (full || rootIDs.has(rootID)) {
                    this.loadContext(record.headerElement, index === 1, true);
                }
            });
        });
    }

    private updateBottomBacklinkSpacing() {
        if (this.type !== "bottom") {
            return;
        }
        if (this.element.classList.contains("sy__backlink--backlinks-empty") ||
            this.element.classList.contains("sy__backlink--mentions-empty")) {
            this.tree.element.classList.remove("backlinkList--divider-spacing");
            return;
        }
        const lastItem = this.tree.element.querySelector(
            ":scope > .b3-list > .backlinkList__item:last-child > .b3-list-item"
        );
        this.tree.element.classList.toggle("backlinkList--divider-spacing",
            !lastItem || !lastItem.querySelector(".b3-list-item__arrow--open"));
    }

    private showBottomLoading() {
        if (this.type !== "bottom") {
            return;
        }
        this.showingLoading = true;
        this.resetRenderedData(false);
        this.element.classList.remove("sy__backlink--backlinks-empty", "sy__backlink--mentions-empty");
        const loadingHTML = '<div class="backlinkList__loading"><img width="32px" height="32px" src="/stage/loading-pure.svg"></div>';
        this.tree.element.innerHTML = loadingHTML;
        this.mTree.element.innerHTML = loadingHTML;
        this.element.querySelector(".listCount").textContent = "";
        this.element.querySelector(".listMCount").textContent = "";
        this.updateBottomBacklinkSpacing();
    }

    private resetRenderedData(resetLists: boolean) {
        cancelHeightAnimation(this.tree.element);
        cancelHeightAnimation(this.mTree.element);
        delete this.tree.element.dataset.heightFolding;
        delete this.mTree.element.dataset.heightFolding;
        this.cancelContextRequests(this.tree.element, false);
        this.cancelContextRequests(this.mTree.element, true);
        this.editors.forEach(item => item.destroy());
        this.editors = [];
        this.itemRecords.forEach(records => records.clear());
        this.listRevision = "";
        this.listQueryKey = "";
        if (resetLists) {
            this.tree.updateData(null);
            this.mTree.updateData(null);
        }
    }

    public prepareForBlock(blockId: string, rootId: string) {
        if (!this.showingLoading) {
            this.saveStatus();
        }
        this.requestID++;
        this.refreshQueued = false;
        this.searchQueued = false;
        this.dirty = false;
        this.pendingRootIDs.clear();
        this.pendingFull = false;
        this.indexChangeVersion++;
        this.notebookId = "";
        this.blockId = blockId;
        this.rootId = rootId;
        this.setRequesting(false);
        this.showBottomLoading();
    }

    public switchBlock(blockId: string, rootId: string, notebookId: string) {
        if (this.blockId) {
            this.saveStatus();
        }
        this.requestID++;
        this.refreshQueued = false;
        this.searchQueued = false;
        this.dirty = false;
        this.pendingRootIDs.clear();
        this.pendingFull = false;
        this.indexChangeVersion++;
        this.resetRenderedData(true);
        this.blockId = blockId;
        this.rootId = rootId;
        this.notebookId = notebookId || "";
        const status = this.status[blockId];
        this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').setAttribute(
            "data-sort",
            (status?.sort ?? window.siyuan.config.editor.backlinkSort).toString(),
        );
        this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').setAttribute(
            "data-sort",
            (status?.mSort ?? window.siyuan.config.editor.backmentionSort).toString(),
        );
        this.setRequesting(false);
        if (!blockId) {
            this.render({
                box: "",
                backlinks: [],
                backmentions: [],
                linkRefsCount: 0,
                mentionsCount: 0,
                k: this.inputsElement[0].value,
                mk: this.inputsElement[1].value,
            }, true);
            return;
        }
        this.searchBacklinks(true);
    }

    private setRequesting(requesting: boolean) {
        this.requesting = requesting;
        this.element.querySelector('.block__icon[data-type="refresh"] svg')?.classList.toggle("fn__rotate", requesting);
    }

    private finishRequest(requestID: number) {
        if (this.destroyed || requestID !== this.requestID) {
            return false;
        }
        this.setRequesting(false);
        return true;
    }

    private runQueuedRequest() {
        if (this.refreshQueued) {
            this.refresh();
            return true;
        }
        if (this.searchQueued) {
            this.searchBacklinks();
            return true;
        }
        return false;
    }

    public refresh() {
        if (!this.blockId) {
            return;
        }
        if (this.requesting) {
            this.refreshQueued = true;
            return;
        }
        this.refreshQueued = false;
        this.setRequesting(true);
        this.dirty = false;
        const requestID = ++this.requestID;
        let responseHandled = false;
        fetchPost("/api/ref/refreshBacklink", {
            id: this.blockId,
        }, () => {
            responseHandled = true;
            if (!this.finishRequest(requestID)) {
                return;
            }
            if (!this.runQueuedRequest()) {
                this.searchBacklinks(false, true);
            }
        }).finally(() => {
            if (responseHandled || !this.finishRequest(requestID)) {
                return;
            }
            if (!this.runQueuedRequest()) {
                // 即使重建索引失败，也重新读取已有的反链数据并释放加载状态。
                this.searchBacklinks(false, true);
            }
        });
    }

    private searchBacklinks(init = false, refreshAllContexts = false) {
        if (!this.blockId) {
            return;
        }
        if (this.requesting) {
            this.searchQueued = true;
            return;
        }
        this.searchQueued = false;
        this.setRequesting(true);
        // 解析当前反链面板所属 box：优先用已记录的 notebookId，首次为空时按 rootId 在已打开的编辑器里查找
        let notebookId = this.notebookId;
        if (!notebookId && this.rootId) {
            getAllModels().editor.some(item => {
                if (item.editor.protyle.block.rootID === this.rootId) {
                    notebookId = item.editor.protyle.notebookId;
                    return true;
                }
            });
        }
        const param: IObject = {
            sort: parseInt(this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').getAttribute("data-sort")).toString(),
            mSort: parseInt(this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').getAttribute("data-sort")).toString(),
            k: this.inputsElement[0].value,
            mk: this.inputsElement[1].value,
            id: this.blockId,
        };
        const blockId = this.blockId;
        if (isEncryptedBox(notebookId)) {
            param.notebook = notebookId;
        }
        const queryKey = JSON.stringify(param);
        const queryChanged = queryKey !== this.listQueryKey;
        if (!queryChanged && this.listRevision) {
            param.knownRevision = this.listRevision;
        }
        const indexChangeVersion = this.indexChangeVersion;
        const changedRootIDs = new Set(this.pendingRootIDs);
        const fullContextRefresh = shouldRefreshAllBacklinkContexts(
            changedRootIDs,
            this.rootId,
            this.blockId,
            refreshAllContexts,
            queryChanged,
            this.pendingFull,
        );
        const requestID = ++this.requestID;
        let responseHandled = false;
        fetchPost("/api/ref/getBacklink2", param, response => {
            responseHandled = true;
            if (!this.finishRequest(requestID) || blockId !== this.blockId) {
                return;
            }
            if (!shouldRenderBacklinkResponse(this.refreshQueued, this.searchQueued)) {
                this.runQueuedRequest();
                return;
            }
            if (!response.data) {
                if (this.showingLoading || init) {
                    this.render(undefined, init);
                }
                return;
            }
            if (shouldSaveBacklinkStatus(init, this.showingLoading)) {
                this.saveStatus();
            }
            this.listQueryKey = queryKey;
            this.listRevision = response.data.revision;
            if (!response.data.unchanged) {
                this.render(response.data, init);
            }
            this.refreshExpandedContexts(changedRootIDs, fullContextRefresh);
            if (indexChangeVersion === this.indexChangeVersion) {
                this.pendingRootIDs.clear();
                this.pendingFull = false;
                this.dirty = false;
            }
            if (this.type === "bottom" && this.dirty) {
                this.refreshIfVisible();
            }
        }).finally(() => {
            if (responseHandled || !this.finishRequest(requestID) || blockId !== this.blockId) {
                return;
            }
            if (!this.runQueuedRequest() && this.type === "bottom" && this.dirty) {
                this.refreshIfVisible();
            }
        });
    }

    public saveStatus() {
        this.status[this.blockId] = {
            sort: parseInt(this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').getAttribute("data-sort")),
            mSort: parseInt(this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').getAttribute("data-sort")),
            scrollTop: this.tree.element.scrollTop,
            mScrollTop: this.mTree.element.scrollTop,
            backlinkOpenIds: [],
            backlinkMOpenIds: [],
            backlinkMStatus: 3, // 0 全展开，1 展开一半箭头向下，2 展开一半箭头向上，3 全收起
            backlinkFolded: this.tree.element.classList.contains("fn__none") ||
                this.tree.element.dataset.heightFolding === "true",
            backmentionFolded: this.type === "bottom" ?
                (this.mTree.element.classList.contains("fn__none") ||
                    this.mTree.element.dataset.heightFolding === "true") :
                this.mTree.element.style.height === "0px"
        };
        this.tree.element.querySelectorAll(".b3-list-item__arrow--open").forEach(item => {
            this.status[this.blockId].backlinkOpenIds.push(item.parentElement.parentElement.getAttribute("data-node-id"));
        });
        this.mTree.element.querySelectorAll(".b3-list-item__arrow--open").forEach(item => {
            this.status[this.blockId].backlinkMOpenIds.push(item.parentElement.parentElement.getAttribute("data-node-id"));
        });
        if (this.mTree.element.style.flex) {
            if (this.mTree.element.style.height === "0px") {
                this.status[this.blockId].backlinkMStatus = 3;
            } else {
                this.status[this.blockId].backlinkMStatus = 0;
            }
        } else {
            if (this.mTree.element.previousElementSibling.querySelector('[data-type="layout"]').getAttribute("aria-label") === window.siyuan.languages.down) {
                this.status[this.blockId].backlinkMStatus = 1;
            } else {
                this.status[this.blockId].backlinkMStatus = 2;
            }
        }
    }

    public render(data?: IBacklinkListResponse, init = false) {
        if (!data) {
            this.listRevision = "";
            this.listQueryKey = "";
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
        const wasLoading = this.showingLoading;
        this.showingLoading = false;

        this.setRequesting(false);
        this.notebookId = data.box;
        this.inputsElement[0].value = data.k;
        this.inputsElement[1].value = data.mk;
        const backlinkAnchor = this.captureScrollAnchor(this.type === "bottom" ? undefined : this.tree);
        const mentionAnchor = this.type === "bottom" ? undefined : this.captureScrollAnchor(this.mTree);
        const backlinkChanged = this.reconcileList(this.tree, data.backlinks, false);
        const backmentionChanged = this.reconcileList(this.mTree, data.backmentions, true);
        if (backlinkChanged || backmentionChanged) {
            this.restoreScrollAnchor(backlinkAnchor);
            this.restoreScrollAnchor(mentionAnchor);
        }
        const bottomVisibility = this.type === "bottom" ?
            getBottomBacklinkVisibility(data.linkRefsCount, data.mentionsCount, data.k, data.mk) : undefined;
        if (bottomVisibility) {
            this.element.classList.toggle("sy__backlink--backlinks-empty", bottomVisibility.hideBacklinks);
            this.element.classList.toggle("sy__backlink--mentions-empty", bottomVisibility.hideMentions);
        }
        this.updateBottomBacklinkSpacing();

        const countElement = this.element.querySelector(".listCount");
        if (data.linkRefsCount === 0 && this.type !== "bottom") {
            countElement.classList.add("fn__none");
        } else {
            countElement.classList.remove("fn__none");
            countElement.textContent = data.linkRefsCount.toString();
        }
        const mCountElement = this.element.querySelector(".listMCount");
        if (data.mentionsCount === 0 && this.type !== "bottom") {
            mCountElement.classList.add("fn__none");
        } else {
            mCountElement.classList.remove("fn__none");
            mCountElement.textContent = data.mentionsCount.toString();
        }
        if (!this.status[this.blockId]) {
            const backlinkState = getInitialBacklinkSectionState(
                window.siyuan.config.editor.backlinkExpandCount,
                data.backlinks.map(item => item.id),
            );
            const backmentionState = getInitialBacklinkSectionState(
                window.siyuan.config.editor.backmentionExpandCount,
                data.backmentions.map(item => item.id),
            );
            const backlinkFolded = backlinkState.folded ||
                (this.type !== "bottom" && data.linkRefsCount === 0 && data.mentionsCount > 0);
            const backmentionFolded = backmentionState.folded ||
                (this.type !== "bottom" && data.mentionsCount === 0);
            this.status[this.blockId] = {
                sort: window.siyuan.config.editor.backlinkSort,
                mSort: window.siyuan.config.editor.backmentionSort,
                scrollTop: 0,
                mScrollTop: 0,
                backlinkOpenIds: backlinkState.openIds,
                backlinkMOpenIds: backmentionState.openIds,
                backlinkMStatus: backlinkFolded ? 0 : (backmentionFolded ? 3 : 1),
                backlinkFolded,
                backmentionFolded
            };
        }

        // restore status
        this.status[this.blockId].backlinkOpenIds.forEach(item => {
            const liElement = this.tree.element.querySelector(`.b3-list-item[data-node-id="${item}"]`) as HTMLElement;
            if (liElement && !liElement.querySelector(".b3-list-item__arrow--open")) {
                this.toggleItem(liElement, false);
            }
        });
        this.status[this.blockId].backlinkMOpenIds.forEach(item => {
            const liElement = this.mTree.element.querySelector(`.b3-list-item[data-node-id="${item}"]`) as HTMLElement;
            if (liElement && !liElement.querySelector(".b3-list-item__arrow--open")) {
                this.toggleItem(liElement, true);
            }
        });
        if (this.type === "bottom") {
            this.restoreBottomLayout(this.tree.element.previousElementSibling.querySelector('[data-type="bLayout"]'), this.tree.element,
                this.status[this.blockId].backlinkFolded);
            this.restoreBottomLayout(this.mTree.element.previousElementSibling.querySelector('[data-type="layout"]'), this.mTree.element,
                this.status[this.blockId].backmentionFolded);
        } else {
            this.applyDockLayout(
                this.status[this.blockId].backlinkFolded,
                this.status[this.blockId].backmentionFolded,
                this.status[this.blockId].backlinkMStatus,
            );
        }
        this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').setAttribute("data-sort", this.status[this.blockId].sort.toString());
        this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').setAttribute("data-sort", this.status[this.blockId].mSort.toString());
        if (bottomVisibility) {
            const empty = bottomVisibility.hidePanel;
            if (this.empty !== empty || wasLoading) {
                this.empty = empty;
                this.emptyChange?.(empty);
            }
        }

        if (init) {
            setTimeout(() => {
                this.tree.element.scrollTop = this.status[this.blockId].scrollTop;
                this.mTree.element.scrollTop = this.status[this.blockId].mScrollTop;
            }, Constants.TIMEOUT_LOAD);
        }
    }

    private applyDockLayout(backlinkFolded: boolean, backmentionFolded: boolean, backlinkMStatus: number) {
        const layoutElement = this.mTree.element.previousElementSibling.querySelector('[data-type="layout"]');
        this.mTree.element.classList.remove("fn__none");
        if (!backlinkFolded && !backmentionFolded) {
            this.tree.element.classList.remove("fn__none");
            this.mTree.element.removeAttribute("style");
            const splitUp = backlinkMStatus === 2;
            layoutElement.setAttribute("aria-label", splitUp ? window.siyuan.languages.up : window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", splitUp ? "#iconUp" : "#iconDown");
        } else if (backlinkFolded) {
            this.tree.element.classList.add("fn__none");
            const height = backmentionFolded ? 0 :
                Math.max(this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2, 0);
            this.mTree.element.setAttribute("style", `flex:none;height:${height}px`);
            layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
        } else {
            this.tree.element.classList.remove("fn__none");
            this.mTree.element.setAttribute("style", "flex:none;height:0px");
            layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
            layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
        }
    }

    private restoreBottomLayout(element: HTMLElement, listElement: HTMLElement, folded: boolean) {
        cancelHeightAnimation(listElement);
        delete listElement.dataset.heightFolding;
        listElement.classList.toggle("fn__none", folded);
        element.setAttribute("aria-label", folded ? window.siyuan.languages.expand : window.siyuan.languages.collapse);
        element.querySelector("use").setAttribute("xlink:href", folded ? "#iconRight" : "#iconDown");
    }

    public markDirty() {
        this.indexChangeVersion++;
        this.dirty = true;
        this.pendingFull = true;
        this.itemRecords.forEach(records => records.forEach(record => {
            record.contextDirty = true;
        }));
    }

    public markIndexDirty(change: IBacklinkIndexChange) {
        if (!change?.backlinkChanged) {
            return;
        }
        this.indexChangeVersion++;
        this.dirty = true;
        this.pendingFull = this.pendingFull || Boolean(change.backlinkFull);
        change.rootIDs?.forEach(rootID => this.pendingRootIDs.add(rootID));
        this.itemRecords.forEach(records => records.forEach((record, rootID) => {
            if (this.pendingFull || this.pendingRootIDs.has(rootID)) {
                record.contextDirty = true;
            }
        }));
    }

    public refreshAfterIndex() {
        if (!this.blockId || !this.dirty || this.element.contains(document.activeElement)) {
            return;
        }
        if (this.type === "bottom") {
            this.refreshIfVisible();
        } else if (this.element.isConnected && this.element.getClientRects().length > 0) {
            this.searchBacklinks();
        }
    }

    public refreshIfVisible(ignoreFocus = false) {
        if (this.type !== "bottom" || !this.dirty) {
            return;
        }
        if (!this.element.isConnected || this.ownerProtyle.element.getClientRects().length === 0) {
            return;
        }
        if (shouldDeferBottomBacklinkRefresh(
            this.element.contains(document.activeElement),
            ignoreFocus
        )) {
            return;
        }
        if (this.empty) {
            this.searchBacklinks();
            return;
        }
        if (this.element.classList.contains("fn__none") ||
            this.element.getClientRects().length === 0) {
            return;
        }
        const rect = this.element.getBoundingClientRect();
        const ownerRect = this.ownerProtyle.contentElement.getBoundingClientRect();
        if (rect.top > ownerRect.bottom + 640 || rect.bottom < ownerRect.top - 640) {
            return;
        }
        this.searchBacklinks();
    }

    public refreshDirty() {
        if (this.dirty) {
            this.refreshIfVisible();
        }
    }

    public destroy() {
        this.destroyed = true;
        cancelHeightAnimation(this.tree.element);
        cancelHeightAnimation(this.mTree.element);
        delete this.tree.element.dataset.heightFolding;
        delete this.mTree.element.dataset.heightFolding;
        if (this.ownerFocusoutListener) {
            this.ownerProtyle.element.removeEventListener("focusout", this.ownerFocusoutListener);
        }
        if (this.panelFocusoutListener) {
            this.element.removeEventListener("focusout", this.panelFocusoutListener);
        }
        this.visibilityObserver?.disconnect();
        this.editors.forEach(item => item.destroy());
        this.editors = [];
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
    }
}
