import {Tree} from "../../util/Tree";
import {fetchPost} from "../../util/fetch";
import {hasClosestBlock, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {isInAndroid, isInHarmony, setStorageVal, writeText} from "../../protyle/util/compatibility";
import {Constants} from "../../constants";
import {MenuItem} from "../../menus/Menu";
import {getPreviousBlock} from "../../protyle/wysiwyg/getBlock";
import {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {transaction, turnsIntoTransaction} from "../../protyle/wysiwyg/transaction";
import {mathRender} from "../../protyle/render/mathRender";
import {genEmptyElement} from "../../block/util";
import {focusBlock} from "../../protyle/util/selection";
import {openMobileFileById} from "../editor";
import {Model} from "../../layout/Model";
import {genUUID} from "../../util/genID";
import {getDocDisplayName, isEncryptedBox} from "../../util/pathName";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";

export class MobileOutline extends Model {
    public tree: Tree;
    public element: HTMLElement;
    public blockId: string;
    public isPreview: boolean;
    private preFilterExpandIds: string[] | null = null;
    private reloadId = 0;
    private touchDragState: {
        selectedElement: HTMLElement;
        startX: number;
        startY: number;
        isDragging: boolean;
        ghostElement: HTMLElement;
        startTime: number;
        selectItem: HTMLElement;
    };

    constructor(options: {
        app: App,
        blockId: string,
        isPreview: boolean
    }) {
        super({app: options.app});
        this.connect({
            id: genUUID(),
            type: "outline",
            msgCallback: this.handleMsgCallback.bind(this)
        });

        this.isPreview = options.isPreview;
        this.blockId = options.blockId;
        this.element = document.querySelector('#sidebar [data-type="sidebar-outline"]');
        this.element.innerHTML = `<div class="toolbar toolbar--border toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">
        ${window.siyuan.languages.outline}
    </div>
    <div class="fn__space"></div>
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <svg data-type="search" class="toolbar__icon"><use xlink:href='#iconFilter'></use></svg>
    <svg data-type="keepCurrentExpand" class="toolbar__icon${window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand ? " toolbar__icon--active" : ""}"><use xlink:href="#iconFocus"></use></svg>
    <svg data-type="expandLevel" class="toolbar__icon"><use xlink:href="#iconList"></use></svg>
    <svg data-type="expand" class="toolbar__icon"><use xlink:href="#iconExpand"></use></svg>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
</div>
<div class="b3-list-item fn__none" data-type="doc-title"></div>
<div class="fn__flex-1" style="padding: 3px 0 8px"></div>`;
        const inputElement = this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        inputElement.addEventListener("blur", () => {
            inputElement.classList.add("fn__none");
            const filterIconElement = inputElement.nextElementSibling as HTMLElement; // search 图标
            const value = inputElement.value;
            if (value) {
                filterIconElement.classList.add("toolbar__icon--active");
            } else {
                filterIconElement.classList.remove("toolbar__icon--active");
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
            element: this.element.lastElementChild as HTMLElement,
            data: null,
            click: (element: HTMLElement, event) => {
                if (event) {
                    const actionElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item__action");
                    if (actionElement) {
                        this.showContextMenu(element);
                        return;
                    }
                }
                const id = element.getAttribute("data-node-id");
                if (this.isPreview) {
                    const headElement = document.getElementById(id);
                    if (headElement) {
                        headElement.scrollIntoView();
                    } else {
                        openMobileFileById(options.app, this.blockId);
                    }
                } else {
                    checkFold(id, (zoomIn) => {
                        openMobileFileById(options.app, id, zoomIn ? [Constants.CB_GET_HL, Constants.CB_GET_ALL, Constants.CB_GET_HTML, Constants.CB_GET_OUTLINE] :
                                [Constants.CB_GET_HL, Constants.CB_GET_OUTLINE, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                            "start");
                    });
                }
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
            },
            blockExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
            topExtHTML: window.siyuan.config.readonly ? undefined : '<span class="b3-list-item__action"><svg><use xlink:href="#iconMore"></use></svg></span>',
        });
        // 为了快捷键的 dispatch
        this.element.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
            this.saveExpendIds();
        });

        // 普通的全部展开按钮
        this.element.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
            this.saveExpendIds();
        });

        // 保持当前标题展开功能
        this.element.querySelector('[data-type="keepCurrentExpand"]').addEventListener("click", (event: MouseEvent & {
            target: Element
        }) => {
            const iconElement = hasClosestByClassName(event.target, "toolbar__icon");
            if (!iconElement) {
                return;
            }
            if (iconElement.classList.contains("toolbar__icon--active")) {
                iconElement.classList.remove("toolbar__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = false;
            } else {
                iconElement.classList.add("toolbar__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = true;
                let focusElement;
                const blockElement = hasClosestBlock(window.siyuan.mobile.editor.protyle.toolbar.range?.startContainer);
                if (blockElement) {
                    focusElement = blockElement;
                }
                if (focusElement) {
                    this.setCurrent(focusElement);
                }
            }
            // 保存keepCurrentExpand状态到localStorage
            setStorageVal(Constants.LOCAL_OUTLINE, window.siyuan.storage[Constants.LOCAL_OUTLINE]);
        });
        this.element.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            if (target.tagName === "INPUT") {
                return;
            }
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("toolbar__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "search":
                            inputElement.classList.remove("fn__none");
                            inputElement.select();
                            break;
                        case "expandLevel":
                            this.showExpandLevelMenu();
                            event.preventDefault();
                            event.stopPropagation();
                            break;
                    }
                    break;
                }
                target = target.parentElement;
            }
        });

        this.bindSort();
        this.element.querySelector('[data-type="doc-title"]').addEventListener("click", () => {
            openMobileFileById(this.app, this.blockId);
        });
        this.reload();
    }

    // 大纲拖拽排序：原生触摸事件实现，长按门槛避免与列表滚动冲突，排序逻辑对齐桌面端 Outline.bindSort
    private bindSort() {
        // 滚动容器为列表本体（不含顶部工具栏），否则边缘滚动判定会把工具栏算进可视区导致拖到列表顶/底部不滚动
        const scrollElement = this.tree.element;
        const contentRect = () => scrollElement.getBoundingClientRect();
        this.element.addEventListener("touchstart", (event: TouchEvent) => {
            if (window.siyuan.config.readonly) return;
            if (this.element.getAttribute("data-loading") === "true") return;
            if (event.touches.length !== 1) return;
            // 仅当触摸到当前文档对应的编辑器时才允许拖拽排序
            const editor = window.siyuan.mobile.editor?.protyle;
            if (!editor || editor.disabled || editor.block.rootID !== this.blockId) return;

            const touch = event.touches[0];
            const liElement = hasClosestByClassName(touch.target as HTMLElement, "b3-list-item") as HTMLElement;
            if (!liElement || liElement.tagName !== "LI") return;

            this.touchDragState = {
                selectedElement: liElement,
                startX: touch.clientX,
                startY: touch.clientY,
                isDragging: false,
                ghostElement: null,
                startTime: Date.now(),
                selectItem: null,
            };
        }, {passive: false});

        this.element.addEventListener("touchmove", (event: TouchEvent) => {
            const state = this.touchDragState;
            if (!state) return;
            const touch = event.touches[0];

            // 长按门槛：未达到长按时间就移动则视为滚动，放弃拖拽
            if (!state.isDragging) {
                if (Date.now() - state.startTime < Constants.TIMEOUT_LONGPRESS &&
                    (Math.abs(touch.clientX - state.startX) > Constants.SIZE_DRAG_THRESHOLD ||
                        Math.abs(touch.clientY - state.startY) > Constants.SIZE_DRAG_THRESHOLD)) {
                    this.touchDragState = null;
                    return;
                }
                if (Math.abs(touch.clientX - state.startX) < Constants.SIZE_DRAG_THRESHOLD &&
                    Math.abs(touch.clientY - state.startY) < Constants.SIZE_DRAG_THRESHOLD) return;
                state.isDragging = true;

                // 创建 ghost 元素，跟随手指移动
                state.selectedElement.style.opacity = "0.38";
                const ghostElement = state.selectedElement.cloneNode(true) as HTMLElement;
                ghostElement.setAttribute("id", "dragGhost");
                ghostElement.firstElementChild.setAttribute("style", "padding-left:4px");
                ghostElement.setAttribute("style", `border-radius: var(--b3-border-radius);background-color: var(--b3-list-hover);pointer-events:none;position: fixed; top: ${touch.clientY}px; left: ${touch.clientX}px; z-index:999997;`);
                document.body.append(ghostElement);
                state.ghostElement = ghostElement;
            }

            // 进入拖拽后阻止原生滚动，避免列表伴随手指滚动
            event.preventDefault();
            event.stopPropagation();
            state.ghostElement.style.top = touch.clientY + "px";
            state.ghostElement.style.left = touch.clientX + "px";
            dragOverScroll({clientY: touch.clientY} as MouseEvent, contentRect(), scrollElement);

            // 通过 elementFromPoint 定位手指下的目标项
            const target = document.elementFromPoint(touch.clientX, touch.clientY);
            const selectItem = target?.closest(".b3-list-item") as HTMLElement;
            if (!selectItem || selectItem.tagName !== "LI" || !scrollElement.contains(selectItem)) {
                this.clearDragIndicators();
                state.selectItem = null;
                return;
            }

            this.clearDragIndicators();
            if (selectItem === state.selectedElement) {
                selectItem.classList.add("dragover__current");
                return;
            }
            const selectRect = selectItem.getBoundingClientRect();
            const dragHeight = selectRect.height * .2;
            if (touch.clientY > selectRect.bottom - dragHeight) {
                selectItem.classList.add("dragover__bottom");
            } else if (touch.clientY < selectRect.top + dragHeight) {
                selectItem.classList.add("dragover__top");
            } else {
                selectItem.classList.add("dragover");
            }
            state.selectItem = selectItem;
        }, {passive: false});

        this.element.addEventListener("touchend", () => {
            const state = this.touchDragState;
            if (!state) return;
            stopScrollAnimation();
            state.selectedElement.style.opacity = "";
            const item = state.selectedElement;

            if (state.isDragging) {
                state.ghostElement?.remove();
                let selectItem = state.selectItem;
                if (!selectItem) {
                    selectItem = this.element.querySelector(".dragover__top, .dragover__bottom, .dragover") as HTMLElement;
                }
                const editor = window.siyuan.mobile.editor?.protyle;
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
                        editor.wysiwyg.element.querySelectorAll('[data-type="NodeHeading"] [contenteditable="true"][spellcheck]').forEach(headingItem => {
                            headingItem.setAttribute("contenteditable", "false");
                        });
                    }
                }
                this.clearDragIndicators();
            }
            this.touchDragState = null;
        });

        this.element.addEventListener("touchcancel", () => {
            stopScrollAnimation();
            if (this.touchDragState?.ghostElement) {
                this.touchDragState.ghostElement.remove();
            }
            if (this.touchDragState?.selectedElement) {
                this.touchDragState.selectedElement.style.opacity = "";
            }
            this.clearDragIndicators();
            this.touchDragState = null;
        });
    }

    // 清理拖拽指示线
    private clearDragIndicators = () => {
        this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach(item => {
            item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
        });
    };

    private handleMsgCallback(data: IWebSocketData) {
        if (data) {
            switch (data.cmd) {
                case "savedoc":
                    this.onTransaction(data);
                    break;
                case "rename":
                    if (this.blockId === data.data.id) {
                        this.updateDocTitle({
                            title: data.data.title,
                            icon: Constants.ZWSP,
                            [Constants.CUSTOM_SY_TITLE_EMPTY]: data.data.empty ? "true" : "false"
                        }, -1);
                    }
                    break;
            }
        }
    }

    public setCurrent(nodeElement: HTMLElement) {
        if (!nodeElement) {
            return;
        }
        if (nodeElement.getAttribute("data-type") === "NodeHeading" &&
            !hasClosestByClassName(nodeElement, "bq") &&
            !hasClosestByClassName(nodeElement, "callout-content")) {
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
                const breadcrumbParam: Record<string, any> = {
                    id: nodeElement.getAttribute("data-node-id"),
                    excludeTypes: []
                };
                const mobileProtyle = window.siyuan.mobile.editor?.protyle;
                if (mobileProtyle && mobileProtyle.block.rootID === this.blockId && isEncryptedBox(mobileProtyle.notebookId)) {
                    breadcrumbParam.notebook = mobileProtyle.notebookId;
                }
                fetchPost("/api/block/getBlockBreadcrumb", breadcrumbParam, (response) => {
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
            const elementRect = this.tree.element.getBoundingClientRect();
            this.tree.element.scrollTop += currentElement.getBoundingClientRect().top -
                (elementRect.top + elementRect.height / 2);
        }
    }

    public reload(callback?: () => void) {
        const protyle = window.siyuan.mobile.editor?.protyle;
        const blockId = protyle?.block.rootID || this.blockId;
        if (!blockId) {
            return;
        }
        const isPreview = protyle ? !protyle.preview.element.classList.contains("fn__none") : this.isPreview;
        if (blockId !== this.blockId) {
            this.tree.updateData(null);
            this.updateDocTitle();
            this.tree.element.scrollTop = 0;
        }
        this.blockId = blockId;
        this.isPreview = isPreview;
        const reloadId = ++this.reloadId;
        const outlineParam: IObject = {
            id: blockId,
            preview: isPreview
        };
        if (protyle && isEncryptedBox(protyle.notebookId)) {
            outlineParam.notebook = protyle.notebookId;
        }
        fetchPost("/api/outline/getDocOutline", outlineParam, response => {
            if (reloadId !== this.reloadId || window.siyuan.mobile.editor?.protyle.block.rootID !== blockId) {
                return;
            }
            this.update(response);
            this.updateDocTitle(protyle?.background?.ial, response.data?.length || 0);
            callback?.();
        });
    }

    public update(data: IWebSocketData) {
        let currentElement = this.element.querySelector(".b3-list-item--focus");
        let currentId;
        if (currentElement) {
            currentId = currentElement.getAttribute("data-node-id");
        }
        const scrollTop = this.tree.element.scrollTop;
        this.tree.updateData(data.data);

        if (this.isPreview) {
            this.tree.element.querySelectorAll(".popover__block").forEach(item => {
                item.classList.remove("popover__block");
            });
            this.tree.element.scrollTop = scrollTop;
        } else if (this.blockId) {
            if ((this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement).value) {
                this.setFilter();
            }
            this.tree.element.scrollTop = scrollTop;
        }
        if (currentId) {
            currentElement = this.element.querySelector(`[data-node-id="${currentId}"]`);
            if (currentElement) {
                currentElement.classList.add("b3-list-item--focus");
            }
        }
        this.element.removeAttribute("data-loading");
    }

    private updateDocTitle(ial?: Record<string, string>, count?: number) {
        const docTitleElement = this.element.querySelector('[data-type="doc-title"]') as HTMLElement;
        if (this.isPreview || !ial) {
            docTitleElement.classList.add("fn__none");
            return;
        }
        let iconHTML = unicode2Emoji(ial.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file,
            "b3-list-item__graphic", true);
        if (ial.icon === Constants.ZWSP && docTitleElement.firstElementChild) {
            iconHTML = docTitleElement.firstElementChild.outerHTML;
        }
        const title = getDocDisplayName(ial.title, ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true");
        docTitleElement.innerHTML = `${iconHTML}<span class="b3-list-item__text">${escapeHtml(title)}</span>${docTitleElement.querySelector(".counter")?.outerHTML || ""}`;
        docTitleElement.setAttribute("title", title);
        docTitleElement.classList.remove("fn__none");
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
    }

    public saveExpendIds() {
        if (window.siyuan.config.readonly || window.siyuan.isPublish) {
            return;
        }

        if (!this.isPreview) {
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
        const keyword = (this.element.querySelector("input.b3-text-field.search__label") as HTMLInputElement).value.toLowerCase();
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

            processUL(this.element.lastElementChild.firstElementChild);
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
    private showExpandLevelMenu() {
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
        window.siyuan.menus.menu.fullscreen("bottom");
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
            this.reload(() => {
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

    /**
     * 显示右键菜单
     */
    private showContextMenu(element: HTMLElement) {
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
                            getSelection()?.removeAllRanges();
                            turnsIntoTransaction({
                                protyle: data.protyle,
                                selectsElement: [data.blockElement],
                                type: "Blocks2Hs",
                                level: currentLevel - 1,
                                unfocus: true,
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
                            getSelection()?.removeAllRanges();
                            turnsIntoTransaction({
                                protyle: data.protyle,
                                selectsElement: [data.blockElement],
                                type: "Blocks2Hs",
                                level: currentLevel + 1,
                                unfocus: true,
                            });
                        }
                    }
                }).element);
            }
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
                    if (!data) {
                        return;
                    }
                    const newId = Lute.NewNodeID();
                    const html = `<div data-subtype="h${currentLevel}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                    const previousID = data.blockElement.previousElementSibling?.getAttribute("data-node-id");
                    data.blockElement.insertAdjacentHTML("beforebegin", html);
                    const newElement = data.blockElement.previousElementSibling;
                    this.focusInsertedHeading(newElement);
                    transaction(data.protyle, [{
                        action: "insert",
                        data: html,
                        id: newId,
                        previousID,
                        parentID: data.blockElement.parentElement.getAttribute("data-node-id") || data.protyle.block.parentID,
                    }], [{
                        action: "delete",
                        id: newId
                    }]);
                }
            }).element);

            // 在后面插入同级标题
            window.siyuan.menus.menu.append(new MenuItem({
                id: "insertSameLevelHeadingAfter",
                icon: "iconAfter",
                label: window.siyuan.languages.insertSameLevelHeadingAfter,
                click: () => {
                    const data = this.getProtyleAndBlockElement(element);
                    if (!data) {
                        return;
                    }
                    const rootID = data.protyle.block.rootID;
                    focusBlock(data.blockElement);
                    fetchPost("/api/block/getHeadingDeleteTransaction", {
                        id,
                    }, (deleteResponse) => {
                        if (window.siyuan.mobile.editor?.protyle !== data.protyle || this.blockId !== rootID ||
                            !deleteResponse.data?.doOperations?.length) {
                            return;
                        }
                        const previousID = deleteResponse.data.doOperations[deleteResponse.data.doOperations.length - 1].id;

                        const newId = Lute.NewNodeID();
                        const html = `<div data-subtype="h${currentLevel}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                        const previousElement = data.protyle.wysiwyg.element.querySelector(`[data-node-id="${previousID}"]`);
                        if (previousElement) {
                            previousElement.insertAdjacentHTML("afterend", html);
                            const newElement = previousElement.nextElementSibling;
                            this.focusInsertedHeading(newElement);
                        }
                        transaction(data.protyle, [{
                            action: "insert",
                            data: html,
                            id: newId,
                            previousID,
                        }], [{
                            action: "delete",
                            id: newId
                        }]);
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
                        const data = this.getProtyleAndBlockElement(element);
                        if (!data) {
                            return;
                        }
                        const rootID = data.protyle.block.rootID;
                        focusBlock(data.blockElement);
                        fetchPost("/api/block/getHeadingDeleteTransaction", {
                            id,
                        }, (deleteResponse) => {
                            if (window.siyuan.mobile.editor?.protyle !== data.protyle || this.blockId !== rootID ||
                                !deleteResponse.data?.doOperations?.length || !deleteResponse.data?.undoOperations) {
                                return;
                            }
                            let previousID = deleteResponse.data.doOperations[deleteResponse.data.doOperations.length - 1].id;
                            deleteResponse.data.undoOperations.find((operationsItem: IOperation, index: number) => {
                                const startIndex = operationsItem.data.indexOf(' data-subtype="h');
                                if (index > 0 && startIndex > -1 && startIndex < 260 && parseInt(operationsItem.data.substring(startIndex + 16, startIndex + 17)) === currentLevel + 1) {
                                    previousID = deleteResponse.data.undoOperations[index - 1].id;
                                    return true;
                                }
                            });
                            const newId = Lute.NewNodeID();
                            const html = `<div data-subtype="h${currentLevel + 1}" data-node-id="${newId}" data-type="NodeHeading" class="h${currentLevel + 1}"><div contenteditable="true" spellcheck="false"><wbr></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div></div>`;
                            const previousElement = data.protyle.wysiwyg.element.querySelector(`[data-node-id="${previousID}"]`);
                            if (previousElement) {
                                previousElement.insertAdjacentHTML("afterend", html);
                                const newElement = previousElement.nextElementSibling;
                                this.focusInsertedHeading(newElement);
                            }
                            transaction(data.protyle, [{
                                action: "insert",
                                data: html,
                                id: newId,
                                previousID,
                            }], [{
                                action: "delete",
                                id: newId
                            }]);
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

        window.siyuan.menus.menu.fullscreen("bottom");
    }

    private getProtyleAndBlockElement(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        if (!window.siyuan.mobile.editor?.protyle) {
            return;
        }
        const blockElement = window.siyuan.mobile.editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
        if (!blockElement) {
            return;
        }
        return {
            protyle: window.siyuan.mobile.editor.protyle, blockElement
        };
    }

    private focusInsertedHeading(element: Element) {
        element.scrollIntoView();
        element.querySelector("wbr")?.remove();
        (element.querySelector('[contenteditable="true"]') as HTMLElement)?.focus({preventScroll: true});
        focusBlock(element);
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
                const protyle = window.siyuan.mobile.editor?.protyle;
                if (!protyle || !this.tree.element.querySelector(`[data-node-id="${id}"]`)) {
                    return;
                }
                const rootID = protyle.block.rootID;
                getSelection()?.removeAllRanges();
                fetchPost("/api/block/getHeadingLevelTransaction", {
                    id,
                    level
                }, (response) => {
                    if (window.siyuan.mobile.editor?.protyle !== protyle || this.blockId !== rootID ||
                        !response.data?.doOperations || !response.data?.undoOperations) {
                        return;
                    }
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
