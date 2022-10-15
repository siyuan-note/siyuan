import {Tab} from "../Tab";
import {Model} from "../Model";
import {getDisplayName} from "../../util/pathName";
import {Tree} from "../../util/Tree";
import {getDockByType, setPanelFocus} from "../util";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Protyle} from "../../protyle";
import {MenuItem} from "../../menus/Menu";

export class Backlink extends Model {
    public element: HTMLElement;
    public inputsElement: NodeListOf<HTMLInputElement>;
    public type: "pin" | "local";
    public blockId: string;
    public rootId: string; // "local" 必传
    private tree: Tree;
    private notebookId: string;
    private mTree: Tree;
    public editors: Protyle[] = [];
    public status: {
        [key: string]: {
            sort: string,
            mSort: string,
            scrollTop: number,
            mScrollTop: number,
            backlinkOpenIds: string[],
            backlinkMOpenIds: string[],
            backlinkMStatus: number // 0 全展开，1 展开一半箭头向下，2 展开一半箭头向上，3 全收起
        }
    } = {};

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
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="${window.siyuan.languages.filterDocNameEnter}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="refresh" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="sort" data-sort="3" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.sort}"><svg><use xlink:href='#iconSort'></use></svg></span>
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
        <input class="b3-text-field b3-text-field--small b3-form__icon-input" placeholder="${window.siyuan.languages.filterDocNameEnter}" />
    </label>
    <span class="fn__space"></span>
    <span data-type="mSort" data-sort="3" class="block__icon b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.sort}"><svg><use xlink:href='#iconSort'></use></svg></span>
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
            click: (element) => {
                this.toggleItem(element, true);
            },
            ctrlClick(element) {
                openFileById({
                    id: element.getAttribute("data-node-id"),
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
                setPanelFocus(this.element);
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon") && target.parentElement.parentElement.isSameNode(this.element)) {
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
                        case "sort":
                        case "mSort":
                            this.showSortMenu(type, target.getAttribute("data-sort"));
                            window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
                            event.stopPropagation();
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
                            this.tree.element.dispatchEvent(new CustomEvent("scroll"));
                            this.mTree.element.dispatchEvent(new CustomEvent("scroll"));
                            break;
                    }
                }
                target = target.parentElement;
            }
        });

        this.searchBacklinks(true);

        if (this.type === "pin") {
            setPanelFocus(this.element);
        }
    }

    private showSortMenu(type: string, sort: string) {
        const clickEvent = (currentSort: string) => {
            (type === "sort" ? this.tree : this.mTree).element.previousElementSibling.querySelector(`[data-type="${type}"]`).setAttribute("data-sort", currentSort);
            this.searchBacklinks();
        };
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "0" ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameASC,
            click: () => {
                clickEvent("0");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "1" ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameDESC,
            click: () => {
                clickEvent("1");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "4" ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameNatASC,
            click: () => {
                clickEvent("4");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "5" ? "iconSelect" : undefined,
            label: window.siyuan.languages.fileNameNatDESC,
            click: () => {
                clickEvent("5");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "9" ? "iconSelect" : undefined,
            label: window.siyuan.languages.createdASC,
            click: () => {
                clickEvent("9");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "10" ? "iconSelect" : undefined,
            label: window.siyuan.languages.createdDESC,
            click: () => {
                clickEvent("10");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "2" ? "iconSelect" : undefined,
            label: window.siyuan.languages.modifiedASC,
            click: () => {
                clickEvent("2");
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: sort === "3" ? "iconSelect" : undefined,
            label: window.siyuan.languages.modifiedDESC,
            click: () => {
                clickEvent("3");
            }
        }).element);
    }

    private toggleItem(liElement: HTMLElement, isMention: boolean) {
        const svgElement = liElement.firstElementChild.firstElementChild;
        if (svgElement.getAttribute("disabled")) {
            return;
        }
        svgElement.setAttribute("disabled", "disabled");
        const docId = liElement.getAttribute("data-node-id");
        if (svgElement.classList.contains("b3-list-item__arrow--open")) {
            svgElement.classList.remove("b3-list-item__arrow--open");
            this.editors.find((item, index) => {
                if (item.protyle.block.rootID === docId) {
                    item.destroy();
                    this.editors.splice(index, 1);
                    return true;
                }
            });
            liElement.nextElementSibling?.remove();
            svgElement.removeAttribute("disabled");
        } else {
            fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                defID: this.blockId,
                refTreeID: docId
            }, (response) => {
                svgElement.removeAttribute("disabled");
                svgElement.classList.add("b3-list-item__arrow--open");
                const editorElement = document.createElement("div");
                editorElement.style.minHeight = "auto";
                editorElement.setAttribute("data-defid", this.blockId);
                editorElement.setAttribute("data-ismention", isMention ? "true" : "false");
                liElement.after(editorElement);
                const editor = new Protyle(editorElement, {
                    blockId: docId,
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

    private refresh() {
        fetchPost("/api/ref/refreshBacklink", {
            id: this.blockId,
        }, () => {
            this.searchBacklinks();
        });
    }

    private searchBacklinks(init = false) {
        const element = this.element.querySelector('.block__icon[data-type="refresh"] svg');
        if (element.classList.contains("fn__rotate")) {
            return;
        }
        element.classList.add("fn__rotate");
        fetchPost("/api/ref/getBacklink2", {
            sort: this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').getAttribute("data-sort"),
            mSort: this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').getAttribute("data-sort"),
            k: this.inputsElement[0].value,
            mk: this.inputsElement[1].value,
            id: this.blockId,
        }, response => {
            if (!init) {
                this.saveStatus();
            }
            this.render(response.data);
        });
    }

    public saveStatus() {
        this.status[this.blockId] = {
            sort: this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').getAttribute("data-sort"),
            mSort: this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').getAttribute("data-sort"),
            scrollTop: this.tree.element.scrollTop,
            mScrollTop: this.mTree.element.scrollTop,
            backlinkOpenIds: [],
            backlinkMOpenIds: [],
            backlinkMStatus: 3 // 0 全展开，1 展开一半箭头向下，2 展开一半箭头向上，3 全收起
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
        }
        const mCountElement = this.element.querySelector(".listMCount");
        if (data.mentionsCount === 0) {
            mCountElement.classList.add("fn__none");
        } else {
            mCountElement.classList.remove("fn__none");
            mCountElement.textContent = data.mentionsCount.toString();
        }

        if (!this.status[this.blockId]) {
            this.status[this.blockId] = {
                sort: "3",
                mSort: "3",
                scrollTop: 0,
                mScrollTop: 0,
                backlinkOpenIds: [],
                backlinkMOpenIds: [],
                backlinkMStatus: 3
            };
            if (data.mentionsCount === 0) {
                this.status[this.blockId].backlinkMStatus = 3;
            } else {
                this.status[this.blockId].backlinkMOpenIds = [data.backmentions[0].id];
                if (data.linkRefsCount === 0) {
                    this.status[this.blockId].backlinkMStatus = 0;
                } else {
                    this.status[this.blockId].backlinkMStatus = 1;
                }
            }
            if (data.linkRefsCount > 0) {
                this.status[this.blockId].backlinkOpenIds = [data.backlinks[0].id];
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
        this.tree.element.previousElementSibling.querySelector('[data-type="sort"]').setAttribute("data-sort", this.status[this.blockId].sort);
        this.mTree.element.previousElementSibling.querySelector('[data-type="mSort"]').setAttribute("data-sort", this.status[this.blockId].mSort);

        setTimeout(() => {
            this.tree.element.scrollTop = this.status[this.blockId].scrollTop;
            this.mTree.element.scrollTop = this.status[this.blockId].mScrollTop;
        }, Constants.TIMEOUT_BLOCKLOAD);
    }
}
