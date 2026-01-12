import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getInstanceById, setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {getAllModels} from "../getAll";
import {hasClosestBlock, hasClosestByClassName, hasTopClosestByClassName} from "../../protyle/util/hasClosest";
import {
    isInAndroid,
    isInHarmony,
    setStorageVal,
    updateHotkeyAfterTip,
    writeText
} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";
import {getPreviousBlock} from "../../protyle/wysiwyg/getBlock";
import {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {transaction, turnsIntoTransaction} from "../../protyle/wysiwyg/transaction";
import {goHome} from "../../protyle/wysiwyg/commonHotkey";
import {Editor} from "../../editor";
import {mathRender} from "../../protyle/render/mathRender";
import {genEmptyElement} from "../../block/util";
import {focusBlock, focusByWbr} from "../../protyle/util/selection";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";

export class Outline extends Model {
    public tree: Tree;
    public element: HTMLElement;
    public headerElement: HTMLElement;
    public type: "pin" | "local";
    public blockId: string;
    public isPreview: boolean;
    private preFilterExpandIds: string[] | null = null;

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
                        case "savedoc":
                            this.onTransaction(data);
                            break;
                        case "rename":
                            if (this.type === "local" && this.blockId === data.data.id) {
                                this.parent.updateTitle(data.data.title);
                            } else {
                                this.updateDocTitle({
                                    title: data.data.title,
                                    icon: Constants.ZWSP
                                }, -1);
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
        options.tab.panelElement.innerHTML = `<div class="block__icons fn__hidescrollbar">
    <div class="block__logo">
        <svg class="block__logoicon"><use xlink:href="#iconAlignCenter"></use></svg>${window.siyuan.languages.outline}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <span data-type="search" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.filter}">
        <svg><use xlink:href='#iconFilter'></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="keepCurrentExpand" class="block__icon ariaLabel${window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.outlineKeepCurrentExpand}">
        <svg><use xlink:href="#iconFocus"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="expandLevel" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.expandLevel}">
        <svg><use xlink:href="#iconList"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.expandAll}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon ariaLabel" aria-label="${window.siyuan.languages.foldAll}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon ariaLabel" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}">
        <svg><use xlink:href='#iconMin'></use></svg>
    </span>
</div>
<div class="b3-list-item fn__none"></div>
<div class="fn__flex-1" style="padding: 3px 0 8px"></div>`;
        this.element = options.tab.panelElement.lastElementChild as HTMLElement;
        this.headerElement = options.tab.panelElement.firstElementChild as HTMLElement;
        const inputElement = this.headerElement.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        inputElement.addEventListener("blur", () => {
            inputElement.classList.add("fn__none");
            const filterIconElement = inputElement.nextElementSibling as HTMLElement; // search 图标
            const value = inputElement.value;
            if (value) {
                filterIconElement.classList.add("block__icon--active");
                filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter + " " + escapeAttr(value));
            } else {
                filterIconElement.classList.remove("block__icon--active");
                filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter);
            }
            if (inputElement.dataset.value !== value) {
                this.setFilter();
            }
        });
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event.isComposing && event.key === "Enter") {
                inputElement.dataset.value = inputElement.value;
                this.setFilter();
            }
        });
        this.tree = new Tree({
            element: this.element,
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
                    checkFold(id, (zoomIn) => {
                        openFileById({
                            app: options.app,
                            id,
                            scrollPosition: "start",
                            action: zoomIn ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML, Constants.CB_GET_OUTLINE] : [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                        });
                    });
                }
            },
            ctrlClick: (element: HTMLElement, event) => {
                const arrowElement = hasClosestByClassName(event.target as Element, "b3-list-item__toggle");
                if (arrowElement && !arrowElement.classList.contains("fn__hidden")) {
                    this.collapseChildren(element);
                    return;
                }
                const id = element.getAttribute("data-node-id");
                openFileById({
                    app: options.app,
                    id,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML],
                    zoomIn: true,
                });
            },
            altClick: (element: HTMLElement, event: MouseEvent) => {
                // alt 点击箭头，切换同层级的所有标题的展开/折叠状态
                const arrowElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__toggle");
                if (arrowElement) {
                    this.collapseSameLevel(element);
                }
            },
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                this.showContextMenu(element, event);
            },
            toggleClick: (liElement) => {
                if (!liElement.nextElementSibling) {
                    return;
                }
                const svgElement = liElement.firstElementChild.firstElementChild;
                if (svgElement.classList.contains("b3-list-item__arrow--open")) {
                    svgElement.classList.remove("b3-list-item__arrow--open");
                    liElement.nextElementSibling.classList.add("fn__none");
                    if (liElement.nextElementSibling.nextElementSibling && liElement.nextElementSibling.nextElementSibling.tagName === "UL") {
                        liElement.nextElementSibling.nextElementSibling.classList.add("fn__none");
                    }
                } else {
                    svgElement.classList.add("b3-list-item__arrow--open");
                    liElement.nextElementSibling.classList.remove("fn__none");
                    if (liElement.nextElementSibling.nextElementSibling && liElement.nextElementSibling.nextElementSibling.tagName === "UL") {
                        liElement.nextElementSibling.nextElementSibling.classList.remove("fn__none");
                    }
                }
                this.saveExpendIds();
            }
        });
        // 为了快捷键的 dispatch
        options.tab.panelElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
            this.saveExpendIds();
        });

        // 普通的全部展开按钮
        options.tab.panelElement.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
            this.saveExpendIds();
        });

        // 保持当前标题展开功能
        options.tab.panelElement.querySelector('[data-type="keepCurrentExpand"]').addEventListener("click", (event: MouseEvent & {
            target: Element
        }) => {
            const iconElement = hasClosestByClassName(event.target, "block__icon");
            if (!iconElement) {
                return;
            }
            if (iconElement.classList.contains("block__icon--active")) {
                iconElement.classList.remove("block__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = false;
            } else {
                iconElement.classList.add("block__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = true;
                let focusElement;
                getAllModels().editor.find(editItem => {
                    if (editItem.editor.protyle.block.rootID === this.blockId) {
                        const selection = getSelection();
                        if (selection.rangeCount > 0) {
                            const blockElement = hasClosestBlock(selection.getRangeAt(0).startContainer);
                            if (blockElement) {
                                focusElement = blockElement;
                                return true;
                            }
                        }
                    }
                });
                if (focusElement) {
                    this.setCurrent(focusElement);
                }
            }
            // 保存keepCurrentExpand状态到localStorage
            setStorageVal(Constants.LOCAL_OUTLINE, window.siyuan.storage[Constants.LOCAL_OUTLINE]);
        });
        options.tab.panelElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            if (target.tagName === "INPUT") {
                return;
            }
            let isFocus = true;
            while (target && !target.isEqualNode(options.tab.panelElement)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("outline").toggleModel("outline", false, true);
                            break;
                        case "search":
                            inputElement.classList.remove("fn__none");
                            inputElement.select();
                            break;
                        case "expandLevel":
                            this.showExpandLevelMenu(target);
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                    }
                    break;
                } else if (this.blockId && (target === this.headerElement.nextElementSibling || target.classList.contains("block__icons"))) {
                    openFileById({
                        app: options.app,
                        id: this.blockId,
                        afterOpen: (model: Editor) => {
                            if (model) {
                                if (this.isPreview) {
                                    model.editor.protyle.preview.element.querySelector(".b3-typography").scrollTop = 0;
                                } else {
                                    goHome(model.editor.protyle);
                                }
                            }
                        }
                    });
                    isFocus = false;
                    break;
                }
                target = target.parentElement;
            }
            if (isFocus) {
                if (this.type === "local") {
                    setPanelFocus(options.tab.panelElement.parentElement.parentElement);
                } else {
                    setPanelFocus(options.tab.panelElement);
                }
            }
        });
        this.bindSort();

        fetchPost("/api/outline/getDocOutline", {
            id: this.blockId,
            preview: this.isPreview
        }, response => {
            this.update(response);
            if (this.blockId) {
                this.updateDocTitle((options.tab.model as Editor)?.editor?.protyle?.background?.ial, response.data?.length || 0);
            }
        });
    }

    private bindSort() {
        this.element.addEventListener("mousedown", (event: MouseEvent) => {
            const item = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
            if (!item || item.tagName !== "LI" || this.element.getAttribute("data-loading") === "true") {
                return;
            }
            const documentSelf = document;
            documentSelf.ondragstart = () => false;
            let ghostElement: HTMLElement;
            let selectItem: HTMLElement;
            let editor: IProtyle;
            getAllModels().editor.find(editItem => {
                if (editItem.editor.protyle.block.rootID === this.blockId) {
                    editor = editItem.editor.protyle;
                    return true;
                }
            });
            const contentRect = this.element.getBoundingClientRect();
            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                if (!editor || editor.disabled || Math.abs(moveEvent.clientY - event.clientY) < 3 &&
                    Math.abs(moveEvent.clientX - event.clientX) < 3) {
                    return;
                }
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                if (!ghostElement) {
                    item.style.opacity = "0.38";
                    ghostElement = item.cloneNode(true) as HTMLElement;
                    this.element.append(ghostElement);
                    ghostElement.setAttribute("id", "dragGhost");
                    ghostElement.firstElementChild.setAttribute("style", "padding-left:4px");
                    ghostElement.setAttribute("style", `border-radius: var(--b3-border-radius);background-color: var(--b3-list-hover);position: fixed; top: ${event.clientY}px; left: ${event.clientX}px; z-index:999997;`);
                }
                ghostElement.style.top = moveEvent.clientY + "px";
                ghostElement.style.left = moveEvent.clientX + "px";
                dragOverScroll(moveEvent, contentRect, this.element);
                if (!this.element.contains(moveEvent.target as Element)) {
                    this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach(item => {
                        item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                    });
                    return;
                }
                selectItem = hasClosestByClassName(moveEvent.target as HTMLElement, "b3-list-item") as HTMLElement;
                if (!selectItem || selectItem.tagName !== "LI" || selectItem.style.position === "fixed") {
                    return;
                }
                this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach(item => {
                    item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                });
                if (selectItem === item) {
                    selectItem.classList.add("dragover__current");
                    return;
                }
                const selectRect = selectItem.getBoundingClientRect();
                const dragHeight = selectRect.height * .2;
                if (moveEvent.clientY > selectRect.bottom - dragHeight) {
                    selectItem.classList.add("dragover__bottom");
                } else if (moveEvent.clientY < selectRect.top + dragHeight) {
                    selectItem.classList.add("dragover__top");
                } else {
                    selectItem.classList.add("dragover");
                }
            };

            documentSelf.onmouseup = () => {
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                ghostElement?.remove();
                item.style.opacity = "";
                // 清理滚动动画
                stopScrollAnimation();
                if (!selectItem) {
                    selectItem = this.element.querySelector(".dragover__top, .dragover__bottom, .dragover");
                }
                let hasChange = true;
                if (selectItem && editor &&
                    (selectItem.classList.contains("dragover__top") || selectItem.classList.contains("dragover__bottom") || selectItem.classList.contains("dragover"))) {
                    let previousID;
                    let parentID;
                    const undoPreviousID = (item.previousElementSibling && item.previousElementSibling.tagName === "UL") ? item.previousElementSibling.previousElementSibling.getAttribute("data-node-id") : item.previousElementSibling?.getAttribute("data-node-id");
                    const undoParentID = item.parentElement.previousElementSibling?.getAttribute("data-node-id");
                    if (selectItem.classList.contains("dragover")) {
                        parentID = selectItem.getAttribute("data-node-id");
                        if (selectItem.nextElementSibling && selectItem.nextElementSibling.tagName === "UL") {
                            selectItem.nextElementSibling.insertAdjacentElement("afterbegin", item);
                        } else {
                            selectItem.insertAdjacentHTML("afterend", `<ul>${item.outerHTML}</ul>`);
                            item.remove();
                        }
                    } else if (selectItem.classList.contains("dragover__top")) {
                        parentID = selectItem.parentElement.previousElementSibling?.getAttribute("data-node-id");
                        if (selectItem.previousElementSibling && selectItem.previousElementSibling.tagName === "UL") {
                            previousID = selectItem.previousElementSibling.previousElementSibling.getAttribute("data-node-id");
                        } else {
                            previousID = selectItem.previousElementSibling?.getAttribute("data-node-id");
                        }
                        if (previousID === item.dataset.nodeId || parentID === item.dataset.nodeId) {
                            hasChange = false;
                        } else {
                            selectItem.before(item);
                        }
                    } else if (selectItem.classList.contains("dragover__bottom")) {
                        previousID = selectItem.getAttribute("data-node-id");
                        if (previousID === item.previousElementSibling?.getAttribute("data-node-id")) {
                            hasChange = false;
                        } else {
                            selectItem.after(item);
                        }
                    }
                    if (hasChange) {
                        this.element.setAttribute("data-loading", "true");

                        transaction(editor, [{
                            action: "moveOutlineHeading",
                            id: item.dataset.nodeId,
                            previousID,
                            parentID,
                        }], [{
                            action: "moveOutlineHeading",
                            id: item.dataset.nodeId,
                            previousID: undoPreviousID,
                            parentID: undoParentID,
                        }]);

                        // https://github.com/siyuan-note/siyuan/issues/10828#issuecomment-2044099675
                        editor.wysiwyg.element.querySelectorAll('[data-type="NodeHeading"] [contenteditable="true"][spellcheck]').forEach(item => {
                            item.setAttribute("contenteditable", "false");
                        });
                        return true;
                    }
                }
                this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach(item => {
                    item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                });
            };
        });
    }

    public updateDocTitle(ial?: IObject, count?: number) {
        const docTitleElement = this.headerElement.nextElementSibling as HTMLElement;
        if (this.type === "pin") {
            if (!ial && typeof count === "undefined") {
                docTitleElement.classList.add("fn__none");
                return;
            }
            if (ial) {
                let iconHTML = `${unicode2Emoji(ial.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true)}`;
                if (ial.icon === Constants.ZWSP && docTitleElement.firstElementChild) {
                    iconHTML = docTitleElement.firstElementChild.outerHTML;
                }
                docTitleElement.innerHTML = `${iconHTML}<span class="b3-list-item__text">${escapeHtml(ial.title)}</span>${docTitleElement.querySelector(".counter")?.outerHTML || ""}`;
                docTitleElement.setAttribute("title", ial.title);
                docTitleElement.classList.remove("fn__none");
            }
            // count 为 -1 时，不对数量进行更新
            if (typeof count === "number" && count !== -1) {
                const counterElement = docTitleElement.querySelector(".counter") as HTMLElement;
                if (count > 0) {
                    if (counterElement) {
                        counterElement.textContent = count.toString();
                    } else {
                        docTitleElement.insertAdjacentHTML("beforeend", `<span class="counter">${count.toString()}</span>`);
                    }
                } else {
                    counterElement?.remove();
                }
            }
        } else {
            docTitleElement.classList.add("fn__none");
        }
    }

    private onTransaction(data: IWebSocketData) {
        if (data.data.rootID !== this.blockId) {
            return;
        }
        let needReload = false;
        const ops = data.data.sources[0];
        ops.doOperations.find((item: IOperation) => {
            if (item.action === "update" &&
                (this.element.querySelector(`.b3-list-item[data-node-id="${item.id}"]`) || item.data.indexOf('data-type="NodeHeading"') > -1)) {
                needReload = true;
                return true;
            } else if (item.action === "insert" && item.data.indexOf('data-type="NodeHeading"') > -1) {
                needReload = true;
                return true;
            } else if (item.action === "delete" || item.action === "move") {
                needReload = true;
                return true;
            }
        });
        if (!needReload && ops.undoOperations) {
            ops.undoOperations.find((item: IOperation) => {
                if (item.action === "update" && item.data?.indexOf('data-type="NodeHeading"') > -1) {
                    needReload = true;
                    return true;
                }
            });
        }
        if (needReload) {
            fetchPost("/api/outline/getDocOutline", {
                id: this.blockId,
                preview: this.isPreview
            }, response => {
                // 文档切换后不再更新原有推送 https://github.com/siyuan-note/siyuan/issues/13409
                if (data.data.rootID !== this.blockId) {
                    return;
                }
                this.update(response);
                this.updateDocTitle(null, response.data?.length || 0);
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

    public setCurrentByPreview(nodeElement: Element) {
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
        if (previousElement && previousElement.id) {
            this.setCurrentById(previousElement.id);
        }
    }

    private setCurrentById(id: string) {
        this.element.querySelectorAll(".b3-list-item.b3-list-item--focus").forEach(item => {
            item.classList.remove("b3-list-item--focus");
        });
        let currentElement = this.element.querySelector(`.b3-list-item[data-node-id="${id}"]`) as HTMLElement;
        if (!currentElement) {
            return;
        }
        if (window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand) {
            let ulElement = currentElement.parentElement;
            while (ulElement && !ulElement.classList.contains("b3-list") && ulElement.tagName === "UL") {
                ulElement.classList.remove("fn__none");
                ulElement.previousElementSibling.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                ulElement = ulElement.parentElement;
            }
            this.saveExpendIds();
        } else {
            while (currentElement && currentElement.clientHeight === 0) {
                currentElement = currentElement.parentElement.previousElementSibling as HTMLElement;
            }
        }
        if (currentElement) {
            currentElement.classList.add("b3-list-item--focus");
            const elementRect = this.element.getBoundingClientRect();
            this.element.scrollTop = this.element.scrollTop + (currentElement.getBoundingClientRect().top - (elementRect.top + elementRect.height / 2));
        }
    }

    public update(data: IWebSocketData, callbackId?: string) {
        let currentElement = this.element.querySelector(".b3-list-item--focus");
        let currentId;
        if (currentElement) {
            currentId = currentElement.getAttribute("data-node-id");
        }
        const scrollTop = this.element.scrollTop;
        if (typeof callbackId !== "undefined") {
            this.blockId = callbackId;
        }
        this.tree.updateData(data.data);

        if (this.isPreview) {
            this.tree.element.querySelectorAll(".popover__block").forEach(item => {
                item.classList.remove("popover__block");
            });
            this.element.scrollTop = scrollTop;
        } else if (this.blockId) {
            if ((this.headerElement.querySelector("input.b3-text-field.search__label") as HTMLInputElement).value) {
                this.setFilter();
            }
            this.element.scrollTop = scrollTop;
        }
        if (currentId) {
            currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
            if (currentElement) {
                currentElement.classList.add("b3-list-item--focus");
            }
        }
        this.element.removeAttribute("data-loading");
    }

    public saveExpendIds() {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return;
        }

        if (!this.isPreview && this.type === "pin") {
            fetchPost("/api/storage/setOutlineStorage", {
                docID: this.blockId,
                val: {
                    expandIds: this.tree.getExpandIds()
                }
            });
        }
    }

    /**
     * 应用大纲筛选
     */
    private setFilter() {
        // 还原 display
        this.element.querySelectorAll('li.b3-list-item[style$="display: none;"]').forEach((item: HTMLElement) => {
            item.style.display = "";
        });
        this.element.querySelectorAll("ul.fn__none").forEach((item) => {
            item.previousElementSibling.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
        });
        const keyword = (this.headerElement.querySelector("input.b3-text-field.search__label") as HTMLInputElement).value.toLowerCase();
        if (keyword) {
            // 首次筛选时记录折叠状态
            if (!this.preFilterExpandIds) {
                this.preFilterExpandIds = this.tree.getExpandIds();
            }
            const processUL = (ul: Element) => {
                let hasMatch = false;
                let hasChildMatch = false;
                const children = ul.querySelectorAll(":scope > li.b3-list-item");

                children.forEach((liItem: HTMLElement) => {
                    const nextUlElement = (liItem.nextElementSibling && liItem.nextElementSibling.tagName === "UL") ? liItem.nextElementSibling as HTMLElement : undefined;

                    let childResult = {hasMatch: false, hasChildMatch: false};
                    if (nextUlElement) {
                        childResult = processUL(nextUlElement);
                    }

                    const arrowElement = liItem.querySelector(".b3-list-item__arrow");
                    if ((liItem.querySelector(".b3-list-item__text")?.textContent || "").trim().toLowerCase().includes(keyword)) {
                        // 当前标题命中
                        liItem.style.display = "";
                        hasMatch = true;

                        if (nextUlElement) {
                            nextUlElement.classList.remove("fn__none");
                            if (childResult.hasMatch || childResult.hasChildMatch) {
                                // 子项也有命中
                                arrowElement.classList.add("b3-list-item__arrow--open");
                                nextUlElement.classList.remove("fn__none");
                            } else {
                                // 子项无命中，折叠所有子项
                                arrowElement.classList.remove("b3-list-item__arrow--open");
                                arrowElement.parentElement.classList.add("fn__hidden");
                                nextUlElement.classList.add("fn__none");
                            }
                        }
                    } else if (childResult.hasMatch || childResult.hasChildMatch) {
                        // 当前标题未命中，但子级有命中
                        liItem.style.display = "";
                        hasChildMatch = true;

                        if (nextUlElement) {
                            nextUlElement.classList.remove("fn__none");
                            arrowElement.classList.add("b3-list-item__arrow--open");
                        }
                    } else {
                        // 当前标题和子级都未命中，隐藏
                        liItem.style.display = "none";
                        if (nextUlElement) {
                            nextUlElement.classList.add("fn__none");
                        }
                    }
                });
                return {hasMatch, hasChildMatch};
            };

            processUL(this.element.firstElementChild);
            return;
        }
        // 恢复折叠状态
        this.tree.setExpandIds(this.preFilterExpandIds);
        this.preFilterExpandIds = null;
    }

    /**
     * 获取标题元素的实际标题级别（H1=1, H2=2, 等等）
     * @param element li元素
     * @returns 标题级别（1-6）
     */
    private getHeadingLevel(element: HTMLElement) {
        return parseInt(element.getAttribute("data-subtype")?.replace("h", "") || "0");
    }

    /**
     * 展开到指定标题级别
     * @param targetLevel 目标标题级别，1-6级（H1-H6），6级表示全部展开
     */
    private expandToLevel(targetLevel: number) {
        if (targetLevel >= 6) {
            // 全部展开
            this.tree.expandAll();
        } else {
            // 展开到指定标题级别
            this.element.querySelectorAll("li.b3-list-item").forEach(item => {
                const headingLevel = this.getHeadingLevel(item as HTMLElement);
                const arrowElement = item.querySelector(".b3-list-item__arrow");
                if (item.nextElementSibling && item.nextElementSibling.tagName === "UL" && arrowElement) {
                    if (headingLevel > 0 && headingLevel < targetLevel) {
                        // 当前标题级别小于目标级别，展开
                        arrowElement.classList.add("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.remove("fn__none");
                    } else if (headingLevel >= targetLevel) {
                        // 当前标题级别大于等于目标级别，折叠
                        arrowElement.classList.remove("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.add("fn__none");
                    }
                }
            });
        }
        this.saveExpendIds();
    }

    /**
     * 显示展开层级菜单
     */
    private showExpandLevelMenu(target: HTMLElement) {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_OUTLINE_EXPAND_LEVEL);
        for (let i = 1; i <= 6; i++) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: `heading${i}`,
                icon: `iconH${i}`,
                label: window.siyuan.languages[`heading${i}`],
                click: () => this.expandToLevel(i)
            }).element);
        }
        const rect = target.getBoundingClientRect();
        window.siyuan.menus.menu.popup({
            x: rect.left,
            y: rect.bottom,
            h: rect.height
        });
        return window.siyuan.menus.menu;
    }

    /**
     * 切换同层级的所有标题的展开/折叠状态（基于标题级别而不是DOM层级）
     */
    private collapseSameLevel(element: HTMLElement, expand?: boolean) {
        // 获取所有相同标题级别的元素
        this.element.querySelectorAll(`li.b3-list-item[data-subtype="${element.getAttribute("data-subtype")}"]`).forEach(item => {
            const arrowElement = item.querySelector(".b3-list-item__arrow");
            if (typeof expand === "undefined") {
                expand = !element.querySelector(".b3-list-item__arrow").classList.contains("b3-list-item__arrow--open");
            }
            if (expand) {
                if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                    item.nextElementSibling.classList.remove("fn__none");
                    arrowElement.classList.add("b3-list-item__arrow--open");
                }
                let ulElement = item.parentElement;
                while (ulElement && !ulElement.classList.contains("b3-list") && ulElement.tagName === "UL") {
                    ulElement.classList.remove("fn__none");
                    ulElement.previousElementSibling.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                    ulElement = ulElement.parentElement;
                }
            } else {
                if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                    item.nextElementSibling.classList.add("fn__none");
                    arrowElement.classList.remove("b3-list-item__arrow--open");
                }
            }
        });
        this.saveExpendIds();
    }

    private collapseChildren(element: HTMLElement, expand?: boolean) {
        const nextElement = element.nextElementSibling;
        if (!nextElement || nextElement.tagName !== "UL") {
            return;
        }
        const arrowElement = element.querySelector(".b3-list-item__arrow");
        if (typeof expand === "undefined") {
            expand = !arrowElement.classList.contains("b3-list-item__arrow--open");
        }
        if (expand) {
            arrowElement.classList.add("b3-list-item__arrow--open");
            nextElement.classList.remove("fn__none");
            nextElement.querySelectorAll("ul").forEach(item => {
                item.previousElementSibling.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                item.classList.remove("fn__none");
            });
        } else {
            arrowElement.classList.remove("b3-list-item__arrow--open");
            nextElement.classList.add("fn__none");
        }
        this.saveExpendIds();
    }

    /**
     * 显示右键菜单
     */
    private showContextMenu(element: HTMLElement, event: MouseEvent) {
        if (this.isPreview) {
            return; // 预览模式下不显示右键菜单
        }
        const currentLevel = this.getHeadingLevel(element);
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_OUTLINE_CONTEXT);
        const id = element.getAttribute("data-node-id");
        if (!window.siyuan.config.readonly) {
            // 升级
            if (currentLevel > 1) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "upgrade",
                    icon: "iconUp",
                    label: window.siyuan.languages.upgrade,
                    click: () => {
                        const data = this.getProtyleAndBlockElement(element);
                        if (data) {
                            turnsIntoTransaction({
                                protyle: data.protyle,
                                selectsElement: [data.blockElement],
                                type: "Blocks2Hs",
                                level: currentLevel - 1
                            });
                        }
                    }
                }).element);
            }

            // 降级
            if (currentLevel < 6) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "downgrade",
                    icon: "iconDown",
                    label: window.siyuan.languages.downgrade,
                    click: () => {
                        const data = this.getProtyleAndBlockElement(element);
                        if (data) {
                            turnsIntoTransaction({
                                protyle: data.protyle,
                                selectsElement: [data.blockElement],
                                type: "Blocks2Hs",
                                level: currentLevel + 1
                            });
                        }
                    }
                }).element);
            }

            // 带子标题转换
            checkFold(id, (zoomIn) => {
                openFileById({
                    app: this.app,
                    id,
                    scrollPosition: "start",
                    action: zoomIn ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML, Constants.CB_GET_OUTLINE] : [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                });
            });
            this.setCurrentById(id);
            const headingSubMenu = [];
            if (currentLevel !== 1) {
                headingSubMenu.push(this.genHeadingTransform(id, 1));
            }
            if (currentLevel !== 2) {
                headingSubMenu.push(this.genHeadingTransform(id, 2));
            }
            if (currentLevel !== 3) {
                headingSubMenu.push(this.genHeadingTransform(id, 3));
            }
            if (currentLevel !== 4) {
                headingSubMenu.push(this.genHeadingTransform(id, 4));
            }
            if (currentLevel !== 5) {
                headingSubMenu.push(this.genHeadingTransform(id, 5));
            }
            if (currentLevel !== 6) {
                headingSubMenu.push(this.genHeadingTransform(id, 6));
            }

            if (headingSubMenu.length > 0) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "tWithSubtitle",
                    type: "submenu",
                    icon: "iconRefresh",
                    label: window.siyuan.languages.tWithSubtitle,
                    submenu: headingSubMenu
                }).element);
            }

            window.siyuan.menus.menu.append(new MenuItem({id: "separator_1", type: "separator"}).element);

            // 在前面插入同级标题
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertSameLevelHeadingBefore",
                icon: "iconBefore",
                label: window.siyuan.languages.insertSameLevelHeadingBefore,
                click: () => {
                    const data = this.getProtyleAndBlockElement(element);
                    const newId = Lute.NewNodeID();
                    const html = `<div data-subtype="h${currentLevel}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                    transaction(data.protyle, [{
                        action: "insert",
                        data: html,
                        id: newId,
                        previousID: data.blockElement.previousElementSibling?.getAttribute("data-node-id"),
                        parentID: data.blockElement.parentElement.getAttribute("data-node-id") || data.protyle.block.parentID,
                    }], [{
                        action: "delete",
                        id: newId
                    }]);
                    data.blockElement.insertAdjacentHTML("beforebegin", html);
                    data.blockElement.previousElementSibling.scrollIntoView();
                    focusByWbr(data.blockElement.previousElementSibling, document.createRange());
                }
            }).element);

            // 在后面插入同级标题
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertSameLevelHeadingAfter",
                icon: "iconAfter",
                label: window.siyuan.languages.insertSameLevelHeadingAfter,
                click: () => {
                    fetchPost("/api/block/getHeadingDeleteTransaction", {
                        id,
                    }, (deleteResponse) => {
                        const data = this.getProtyleAndBlockElement(element);
                        const previousID = deleteResponse.data.doOperations[deleteResponse.data.doOperations.length - 1].id;

                        const newId = Lute.NewNodeID();
                        const html = `<div data-subtype="h${currentLevel}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                        transaction(data.protyle, [{
                            action: "insert",
                            data: html,
                            id: newId,
                            previousID,
                        }], [{
                            action: "delete",
                            id: newId
                        }]);
                        const previousElement = data.protyle.wysiwyg.element.querySelector(`[data-node-id="${previousID}"]`);
                        if (previousElement) {
                            previousElement.insertAdjacentHTML("afterend", html);
                            previousElement.nextElementSibling.scrollIntoView();
                            focusByWbr(previousElement.nextElementSibling, document.createRange());
                        }
                    });
                }
            }).element);

            // 添加子标题
            if (currentLevel < 6) { // 只有当前级别小于6时才能添加子标题
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "addChildHeading",
                    icon: "iconAdd",
                    label: window.siyuan.languages.addChildHeading,
                    click: () => {
                        fetchPost("/api/block/getHeadingDeleteTransaction", {
                            id,
                        }, (deleteResponse) => {
                            let previousID = deleteResponse.data.doOperations[deleteResponse.data.doOperations.length - 1].id;
                            deleteResponse.data.undoOperations.find((operationsItem: IOperation, index: number) => {
                                const startIndex = operationsItem.data.indexOf(' data-subtype="h');
                                if (startIndex > -1 && startIndex < 260 && parseInt(operationsItem.data.substring(startIndex + 16, startIndex + 17)) === currentLevel + 1) {
                                    previousID = deleteResponse.data.undoOperations[index - 1].id;
                                    return true;
                                }
                            });


                            const data = this.getProtyleAndBlockElement(element);
                            const newId = Lute.NewNodeID();
                            const html = `<div data-subtype="h${currentLevel + 1}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel + 1}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                            transaction(data.protyle, [{
                                action: "insert",
                                data: html,
                                id: newId,
                                previousID,
                            }], [{
                                action: "delete",
                                id: newId
                            }]);
                            const previousElement = data.protyle.wysiwyg.element.querySelector(`[data-node-id="${previousID}"]`);
                            if (previousElement) {
                                previousElement.insertAdjacentHTML("afterend", html);
                                previousElement.nextElementSibling.scrollIntoView();
                                focusByWbr(previousElement.nextElementSibling, document.createRange());
                            }
                        });
                    }
                }).element);
            }

            window.siyuan.menus.menu.append(new MenuItem({id: "separator_2", type: "separator"}).element);
        }

        // 复制带子标题
        window.siyuan.menus.menu.append(new MenuItem({
            id: "copyHeadings1",
            icon: "iconCopy",
            label: `${window.siyuan.languages.copy} ${window.siyuan.languages.headings1}`,
            click: () => {
                const data = this.getProtyleAndBlockElement(element);
                fetchPost("/api/block/getHeadingChildrenDOM", {
                    id,
                    removeFoldAttr: data.blockElement.getAttribute("fold") !== "1"
                }, (response) => {
                    if (isInAndroid()) {
                        window.JSAndroid.writeHTMLClipboard(data.protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                    } else if (isInHarmony()) {
                        window.JSHarmony.writeHTMLClipboard(data.protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                    } else {
                        writeText(response.data + Constants.ZWSP);
                    }
                });
            }
        }).element);

        if (!window.siyuan.config.readonly) {
            // 剪切带子标题
            window.siyuan.menus.menu.append(new MenuItem({
                id: "cutHeadings1",
                icon: "iconCut",
                label: `${window.siyuan.languages.cut} ${window.siyuan.languages.headings1}`,
                click: () => {
                    const data = this.getProtyleAndBlockElement(element);
                    fetchPost("/api/block/getHeadingChildrenDOM", {
                        id,
                        removeFoldAttr: data.blockElement.getAttribute("fold") !== "1"
                    }, (response) => {
                        if (isInAndroid()) {
                            window.JSAndroid.writeHTMLClipboard(data.protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else if (isInHarmony()) {
                            window.JSHarmony.writeHTMLClipboard(data.protyle.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
                        } else {
                            writeText(response.data + Constants.ZWSP);
                        }
                        fetchPost("/api/block/getHeadingDeleteTransaction", {
                            id,
                        }, (deleteResponse) => {
                            deleteResponse.data.doOperations.forEach((operation: IOperation) => {
                                data.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                                    itemElement.remove();
                                });
                            });
                            if (data.protyle.wysiwyg.element.childElementCount === 0) {
                                const newID = Lute.NewNodeID();
                                const emptyElement = genEmptyElement(false, false, newID);
                                data.protyle.wysiwyg.element.insertAdjacentElement("afterbegin", emptyElement);
                                deleteResponse.data.doOperations.push({
                                    action: "insert",
                                    data: emptyElement.outerHTML,
                                    id: newID,
                                    parentID: data.protyle.block.parentID
                                });
                                deleteResponse.data.undoOperations.push({
                                    action: "delete",
                                    id: newID,
                                });
                                focusBlock(emptyElement);
                            }
                            transaction(data.protyle, deleteResponse.data.doOperations, deleteResponse.data.undoOperations);
                        });
                    });
                }
            }).element);

            // 删除
            window.siyuan.menus.menu.append(new MenuItem({
                id: "deleteHeadings1",
                icon: "iconTrashcan",
                label: `${window.siyuan.languages.delete} ${window.siyuan.languages.headings1}`,
                click: () => {
                    const data = this.getProtyleAndBlockElement(element);
                    fetchPost("/api/block/getHeadingDeleteTransaction", {
                        id,
                    }, (response) => {
                        response.data.doOperations.forEach((operation: IOperation) => {
                            data.protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                                itemElement.remove();
                            });
                        });
                        if (data.protyle.wysiwyg.element.childElementCount === 0) {
                            const newID = Lute.NewNodeID();
                            const emptyElement = genEmptyElement(false, false, newID);
                            data.protyle.wysiwyg.element.insertAdjacentElement("afterbegin", emptyElement);
                            response.data.doOperations.push({
                                action: "insert",
                                data: emptyElement.outerHTML,
                                id: newID,
                                parentID: data.protyle.block.parentID
                            });
                            response.data.undoOperations.push({
                                action: "delete",
                                id: newID,
                            });
                            focusBlock(emptyElement);
                        }
                        transaction(data.protyle, response.data.doOperations, response.data.undoOperations);
                    });
                }
            }).element);
        }
        window.siyuan.menus.menu.append(new MenuItem({id: "separator_3", type: "separator"}).element);

        // 展开子标题
        window.siyuan.menus.menu.append(new MenuItem({
            id: "expandChildHeading",
            icon: "iconExpand",
            label: window.siyuan.languages.expandChildHeading,
            accelerator: "⌘" + window.siyuan.languages.clickArrow,
            click: () => this.collapseChildren(element, true)
        }).element);

        // 折叠子标题
        window.siyuan.menus.menu.append(new MenuItem({
            id: "foldChildHeading",
            icon: "iconContract",
            label: window.siyuan.languages.foldChildHeading,
            accelerator: "⌘" + window.siyuan.languages.clickArrow,
            click: () => this.collapseChildren(element, false)
        }).element);

        // 展开同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            id: "expandSameLevelHeading",
            icon: "iconExpand",
            label: window.siyuan.languages.expandSameLevelHeading,
            accelerator: "⌥" + window.siyuan.languages.clickArrow,
            click: () => this.collapseSameLevel(element, true)
        }).element);

        // 折叠同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            id: "foldSameLevelHeading",
            icon: "iconContract",
            label: window.siyuan.languages.foldSameLevelHeading,
            accelerator: "⌥" + window.siyuan.languages.clickArrow,
            click: () => this.collapseSameLevel(element, false)
        }).element);

        // 全部展开
        window.siyuan.menus.menu.append(new MenuItem({
            id: "expandAll",
            icon: "iconExpand",
            label: window.siyuan.languages.expandAll,
            click: () => {
                this.tree.expandAll();
                this.saveExpendIds();
            }
        }).element);

        // 全部折叠
        window.siyuan.menus.menu.append(new MenuItem({
            id: "foldAll",
            icon: "iconContract",
            label: window.siyuan.languages.foldAll,
            click: () => {
                this.tree.collapseAll();
                this.saveExpendIds();
            }
        }).element);

        window.siyuan.menus.menu.popup({
            x: event.clientX,
            y: event.clientY
        });
    }

    private getProtyleAndBlockElement(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        let protyle: IProtyle;
        let blockElement: HTMLElement;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                protyle = editItem.editor.protyle;
                blockElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                return true;
            }
        });

        if (!protyle || !blockElement) {
            return;
        }
        return {
            protyle, blockElement
        };
    }

    /**
     * 生成标题级别转换菜单项
     */
    private genHeadingTransform(id: string, level: number) {
        return {
            id: "heading" + level,
            iconHTML: "",
            icon: "iconHeading" + level,
            label: window.siyuan.languages["heading" + level],
            click: () => {
                let protyle: IProtyle;
                getAllModels().editor.find(editItem => {
                    if (editItem.editor.protyle.block.rootID === this.blockId) {
                        protyle = editItem.editor.protyle;
                        return true;
                    }
                });

                if (!protyle) {
                    return;
                }

                fetchPost("/api/block/getHeadingLevelTransaction", {
                    id,
                    level
                }, (response) => {
                    response.data.doOperations.forEach((operation: any, index: number) => {
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            itemElement.outerHTML = operation.data;
                        });
                        // 使用 outer 后元素需要重新查询
                        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            mathRender(itemElement);
                        });
                        if (index === 0) {
                            const focusElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${operation.id}"]`);
                            if (focusElement) {
                                focusElement.scrollIntoView({behavior: "smooth", block: "center"});
                            }
                        }
                    });
                    transaction(protyle, response.data.doOperations, response.data.undoOperations);
                });
            }
        };
    }
}
