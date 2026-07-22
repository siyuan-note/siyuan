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
import {App} from "../../index";
import {isSupportCSSHL, searchMarkRender} from "../../protyle/render/searchMarkRender";
import {getDocDisplayName, isEncryptedBox} from "../../util/pathName";
import {getAllModels} from "../getAll";
import {hideElements} from "../../protyle/ui/hideElements";

export class Backlink extends Model {
    public element: HTMLElement;
    public inputsElement: NodeListOf<HTMLInputElement>;
    public type: "pin" | "local" | "bottom";
    public blockId: string;
    public rootId: string; // "local" 和 "bottom" 必传
    public ownerProtyle?: IProtyle;
    public tree: Tree;
    private notebookId: string;
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
            backlinkFolded?: boolean,
            backmentionFolded?: boolean
        }
    } = {};
    private dirty = false;
    private destroyed = false;
    private ownerFocusoutListener?: (event: FocusEvent) => void;

    constructor(options: {
        app: App,
        tab?: Tab,
        element?: HTMLElement,
        blockId: string,
        rootId?: string,
        type: "pin" | "local" | "bottom",
        ownerProtyle?: IProtyle
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
        this.type = options.type;
        this.ownerProtyle = options.ownerProtyle;
        this.element = options.element || options.tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__backlink", "dockPanel");
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
        this.element.innerHTML = `<div class="block__icons">
    ${this.type === "bottom" ? `<span data-type="bLayout" class="block__icon block__icon--show fn__flex-center backlinkList__toggle ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}"><svg><use xlink:href="#iconDown"></use></svg></span>` : ""}
    <div class="block__logo fn__flex-1${this.type === "bottom" ? " fn__pointer" : ""}"${this.type === "bottom" ? ' data-type="backlink"' : ""}>${window.siyuan.languages.backlinks}</div>
    <span class="counter listCount" style="margin-left: 0"></span>
    <span class="fn__space"></span>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <span data-type="search" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
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
<div class="block__icons">
    ${this.type === "bottom" ? `<span data-type="layout" class="block__icon block__icon--show fn__flex-center backlinkList__toggle ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}"><svg><use xlink:href="#iconDown"></use></svg></span>` : ""}
    <div class="block__logo fn__flex-1 fn__pointer" data-type="mention">${window.siyuan.languages.mentions}</div>
    <span class="counter listMCount" style="margin-left: 0;"></span>
    <span class="fn__space"></span>
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
                const filterIconElement = inputElement.nextElementSibling;
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
            Array.from(this.tree.element.firstElementChild.children).forEach((item: HTMLElement) => {
                if (item.tagName === "LI" && !item.querySelector(".b3-list-item__arrow--open")) {
                    this.toggleItem(item, false);
                }
            });
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
                            Array.from(this.mTree.element.firstElementChild.children).forEach((item: HTMLElement) => {
                                if (item.tagName === "LI" && !item.querySelector(".b3-list-item__arrow--open")) {
                                    this.toggleItem(item, true);
                                }
                            });
                            event.stopPropagation();
                            break;
                        case "mCollapse":
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
                                event.stopPropagation();
                            }
                            break;
                        case "mention":
                            if (this.type === "bottom") {
                                this.setBottomLayout(target.parentElement.querySelector('[data-type="layout"]'), this.mTree.element);
                            } else {
                                this.setLayout(target.parentElement.querySelector('[data-type="layout"]'));
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

    private setBottomLayout(element: HTMLElement, listElement: HTMLElement) {
        const folded = !listElement.classList.contains("fn__none");
        if (folded) {
            this.hideEditorGutters(listElement);
        }
        listElement.classList.toggle("fn__none", folded);
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
        svgElement.setAttribute("disabled", "disabled");
        const docId = liElement.getAttribute("data-node-id");
        const editor = this.editors.find(item => item.protyle.element === liElement.nextElementSibling);
        if (svgElement.classList.contains("b3-list-item__arrow--open")) {
            svgElement.classList.remove("b3-list-item__arrow--open");
            if (editor && this.type === "bottom") {
                hideElements(["gutter"], editor.protyle);
                editor.protyle.element.classList.add("fn__none");
            } else if (editor) {
                editor.destroy();
                this.editors.splice(this.editors.indexOf(editor), 1);
                editor.protyle.element.remove();
            }
            svgElement.removeAttribute("disabled");
            this.updateBottomBacklinkSpacing();
        } else if (editor) {
            editor.protyle.element.classList.remove("fn__none");
            svgElement.removeAttribute("disabled");
            svgElement.classList.add("b3-list-item__arrow--open");
            this.updateBottomBacklinkSpacing();
        } else {
            const keyword = isMention ? this.inputsElement[1].value : this.inputsElement[0].value;
            const blockId = this.blockId;
            fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                defID: blockId,
                refTreeID: docId,
                highlight: !isSupportCSSHL(),
                keyword,
            }, (response) => {
                if (this.destroyed || blockId !== this.blockId || !liElement.isConnected) {
                    return;
                }
                svgElement.removeAttribute("disabled");
                svgElement.classList.add("b3-list-item__arrow--open");
                this.updateBottomBacklinkSpacing();
                const editorElement = document.createElement("div");
                editorElement.style.minHeight = "auto";
                editorElement.setAttribute("data-defid", blockId);
                editorElement.setAttribute("data-ismention", isMention ? "true" : "false");
                liElement.after(editorElement);
                const editor = new Protyle(this.app, editorElement, {
                    blockId: docId,
                    click: {
                        preventInsetEmptyBlock: true
                    },
                    backlinkData: isMention ? response.data.backmentions : response.data.backlinks,
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
                editor.protyle.notebookId = liElement.getAttribute("data-notebook-id");
                searchMarkRender(editor.protyle, response.data.keywords);
                this.editors.push(editor);
            });
        }
    }

    private hideEditorGutters(element: Element) {
        this.editors.forEach(editor => {
            if (editor.protyle.element === element || element.contains(editor.protyle.element)) {
                hideElements(["gutter"], editor.protyle);
            }
        });
    }

    private updateBottomBacklinkSpacing() {
        if (this.type !== "bottom") {
            return;
        }
        const lastItem = this.tree.element.querySelector(":scope > .b3-list > .b3-list-item:last-of-type");
        this.tree.element.classList.toggle("backlinkList--divider-spacing",
            !lastItem || !lastItem.querySelector(".b3-list-item__arrow--open"));
    }

    private showBottomLoading() {
        if (this.type !== "bottom") {
            return;
        }
        const loadingHTML = '<div class="backlinkList__loading"><img width="32px" height="32px" src="/stage/loading-pure.svg"></div>';
        this.tree.element.innerHTML = loadingHTML;
        this.mTree.element.innerHTML = loadingHTML;
        this.updateBottomBacklinkSpacing();
    }

    public refresh() {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (!this.blockId || element.classList.contains("fn__rotate")) {
            return;
        }
        element.classList.add("fn__rotate");
        this.dirty = false;
        fetchPost("/api/ref/refreshBacklink", {
            id: this.blockId,
        }, () => {
            if (this.destroyed) {
                return;
            }
            element.classList.remove("fn__rotate");
            this.searchBacklinks();
        });
    }

    private searchBacklinks(init = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate")) {
            return;
        }
        element.classList.add("fn__rotate");
        this.dirty = false;
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
        fetchPost("/api/ref/getBacklink2", param, response => {
            if (this.destroyed || blockId !== this.blockId) {
                return;
            }
            if (!init) {
                this.saveStatus();
            }
            this.render(response.data);
            if (this.type === "bottom" && this.dirty) {
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
            backlinkFolded: this.tree.element.classList.contains("fn__none"),
            backmentionFolded: this.mTree.element.classList.contains("fn__none")
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

    public render(data: {
        box: string,
        backlinks: IBlockTree[],
        backmentions: IBlockTree[],
        linkRefsCount: number,
        mentionsCount: number,
        k: string,
        mk: string
    }) {
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
            this.status[this.blockId] = {
                sort: window.siyuan.config.editor.backlinkSort,
                mSort: window.siyuan.config.editor.backmentionSort,
                scrollTop: 0,
                mScrollTop: 0,
                backlinkOpenIds: [],
                backlinkMOpenIds: [],
                backlinkMStatus: 3,
                backlinkFolded: false,
                backmentionFolded: false
            };
            if (data.mentionsCount === 0 || window.siyuan.config.editor.backmentionExpandCount === -1) {
                this.status[this.blockId].backlinkMStatus = 3;
            } else {
                Array.from({length: window.siyuan.config.editor.backmentionExpandCount}).forEach((item, index) => {
                    if (data.backmentions[index]) {
                        this.status[this.blockId].backlinkMOpenIds.push(data.backmentions[index].id);
                    }
                });
                if (data.mentionsCount === 0) {
                    this.status[this.blockId].backlinkMStatus = 3;
                } else {
                    if (data.linkRefsCount === 0) {
                        this.status[this.blockId].backlinkMStatus = 0;
                    } else {
                        this.status[this.blockId].backlinkMStatus = 1;
                    }
                }
            }
            if (data.linkRefsCount > 0) {
                Array.from({length: window.siyuan.config.editor.backlinkExpandCount}).forEach((item, index) => {
                    if (data.backlinks[index]) {
                        this.status[this.blockId].backlinkOpenIds.push(data.backlinks[index].id);
                    }
                });
            }
        }

        // restore status
        this.status[this.blockId].backlinkOpenIds.forEach(item => {
            const liElement = this.tree.element.querySelector(`.b3-list-item[data-node-id="${item}"]`) as HTMLElement;
            if (liElement) {
                this.toggleItem(liElement, false);
            }
        });
        this.status[this.blockId].backlinkMOpenIds.forEach(item => {
            const liElement = this.mTree.element.querySelector(`.b3-list-item[data-node-id="${item}"]`) as HTMLElement;
            if (liElement) {
                this.toggleItem(liElement, true);
            }
        });
        if (this.type === "bottom") {
            this.restoreBottomLayout(this.tree.element.previousElementSibling.querySelector('[data-type="bLayout"]'), this.tree.element,
                this.status[this.blockId].backlinkFolded);
            this.restoreBottomLayout(this.mTree.element.previousElementSibling.querySelector('[data-type="layout"]'), this.mTree.element,
                this.status[this.blockId].backmentionFolded);
        } else {
            // 0 全展开，1 展开一半箭头向下，2 展开一半箭头向上，3 全收起
            const layoutElement = this.mTree.element.previousElementSibling.querySelector('[data-type="layout"]');
            if (this.status[this.blockId].backlinkMStatus === 2 || this.status[this.blockId].backlinkMStatus === 1) {
                this.tree.element.classList.remove("fn__none");
                this.mTree.element.removeAttribute("style");
                if (this.status[this.blockId].backlinkMStatus === 1) {
                    layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
                    layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
                } else {
                    layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
                    layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
                }
            } else if (this.status[this.blockId].backlinkMStatus === 3) {
                this.tree.element.classList.remove("fn__none");
                this.mTree.element.setAttribute("style", "flex:none;height:0px");
                layoutElement.setAttribute("aria-label", window.siyuan.languages.up);
                layoutElement.querySelector("use").setAttribute("xlink:href", "#iconUp");
            } else {
                this.tree.element.classList.add("fn__none");
                this.mTree.element.setAttribute("style", `flex:none;height:${this.element.clientHeight - this.tree.element.previousElementSibling.clientHeight * 2}px`);
                layoutElement.setAttribute("aria-label", window.siyuan.languages.down);
                layoutElement.querySelector("use").setAttribute("xlink:href", "#iconDown");
            }
        }
        this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').setAttribute("data-sort", this.status[this.blockId].sort.toString());
        this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').setAttribute("data-sort", this.status[this.blockId].mSort.toString());

        setTimeout(() => {
            this.tree.element.scrollTop = this.status[this.blockId].scrollTop;
            this.mTree.element.scrollTop = this.status[this.blockId].mScrollTop;
        }, Constants.TIMEOUT_LOAD);
    }

    private restoreBottomLayout(element: HTMLElement, listElement: HTMLElement, folded: boolean) {
        listElement.classList.toggle("fn__none", folded);
        element.setAttribute("aria-label", folded ? window.siyuan.languages.expand : window.siyuan.languages.collapse);
        element.querySelector("use").setAttribute("xlink:href", folded ? "#iconRight" : "#iconDown");
    }

    public markDirty() {
        this.dirty = true;
    }

    public refreshIfVisible(ignoreFocus = false) {
        if (this.type !== "bottom" || !this.dirty) {
            return;
        }
        if (!ignoreFocus && this.ownerProtyle.element.contains(document.activeElement)) {
            return;
        }
        if (this.element.classList.contains("fn__none") ||
            !this.element.isConnected || this.element.getClientRects().length === 0 ||
            this.ownerProtyle.element.getClientRects().length === 0) {
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
        if (this.ownerFocusoutListener) {
            this.ownerProtyle.element.removeEventListener("focusout", this.ownerFocusoutListener);
        }
        this.editors.forEach(item => item.destroy());
        this.editors = [];
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.close();
        }
    }
}
