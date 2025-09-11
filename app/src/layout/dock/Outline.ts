import {Tab} from "../Tab";
import {Model} from "../Model";
import {Tree} from "../../util/Tree";
import {getInstanceById, setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {getAllModels} from "../getAll";
import {hasClosestBlock, hasClosestByClassName, hasTopClosestByClassName} from "../../protyle/util/hasClosest";
import {setStorageVal, updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {escapeHtml} from "../../util/escape";
import {unicode2Emoji} from "../../emoji";
import {getPreviousBlock} from "../../protyle/wysiwyg/getBlock";
import {App} from "../../index";
import {checkFold} from "../../util/noRelyPCFunction";
import {transaction} from "../../protyle/wysiwyg/transaction";
import {goHome} from "../../protyle/wysiwyg/commonHotkey";
import {Editor} from "../../editor";

export class Outline extends Model {
    public tree: Tree;
    public element: HTMLElement;
    public headerElement: HTMLElement;
    public type: "pin" | "local";
    public blockId: string;
    public isPreview: boolean;
    public resetLevelDisplay: () => void;

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
        <svg class="block__logoicon"><use xlink:href="#iconAlignCenter"></use></svg>${window.siyuan.languages.outline}
    </div>
    <span class="fn__flex-1 fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw${window.siyuan.storage[Constants.LOCAL_OUTLINE]?.keepExpand ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.stickOpen}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="b3-list-item fn__none"></div>
<div class="outline-level-control" style="padding: 8px 12px; border-bottom: 1px solid var(--b3-border-color); display: none; ">
    <div style="display: flex; align-items: center; font-size: 12px; color: var(--b3-theme-on-surface-light);">
        <span style="margin-right: 8px; min-width: 60px;">${window.siyuan.languages.outlineExpandLevel}:</span>
        <div class="outline-level-dots" style="flex: 1; margin: 0 8px; position: relative; height: 20px; display: flex; align-items: center; justify-content: space-between;">
            <div class="outline-level-line" style="position: absolute; top: 50%; left: 8px; right: 8px; height: 2px; background: var(--b3-theme-on-surface-light); transform: translateY(-50%);"></div>
            <div class="outline-level-dot active" data-level="1" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-primary); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
            <div class="outline-level-dot" data-level="2" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-on-surface-light); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
            <div class="outline-level-dot" data-level="3" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-on-surface-light); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
            <div class="outline-level-dot" data-level="4" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-on-surface-light); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
            <div class="outline-level-dot" data-level="5" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-on-surface-light); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
            <div class="outline-level-dot" data-level="6" style="position: relative; width: 8px; height: 8px; border-radius: 50%; background: var(--b3-theme-on-surface-light); cursor: pointer; z-index: 1; border: 2px solid var(--b3-theme-surface); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);"></div>
        </div>
        <span class="outline-level-text" style="min-width: 40px; text-align: right;"></span>
    </div>
</div>
<div class="fn__flex-1" style="padding: 3px 0 8px"></div>`;
        this.element = options.tab.panelElement.children[3] as HTMLElement; // 更新为第四个子元素（大纲内容）
        this.headerElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.tree = new Tree({
            element: options.tab.panelElement.children[3] as HTMLElement, // 使用第四个子元素作为树容器
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
                            action: zoomIn ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML, Constants.CB_GET_OUTLINE] : [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE, Constants.CB_GET_SETID, Constants.CB_GET_CONTEXT, Constants.CB_GET_HTML],
                        });
                    });
                }
            },
            ctrlClick(element: HTMLElement) {
                const id = element.getAttribute("data-node-id");
                openFileById({
                    app: options.app,
                    id,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL, Constants.CB_GET_HTML],
                    zoomIn: true,
                });
            },
            altClick: (element: HTMLElement, event?: MouseEvent) => {
                // 检查是否点击的是标题层级图标
                if (event && event.target) {
                    const target = event.target as HTMLElement;
                    const graphicElement = target.closest(".b3-list-item__graphic.popover__block");
                    if (graphicElement) {
                        this.collapseSameLevel(element);
                    }
                }
            },
            onToggleChange: () => {
                // 实时保存折叠状态变化
                if (!this.isPreview) {
                    const expandIds = this.tree.getExpandIds();
                    fetchPost("/api/storage/setOutlineStorage", {
                        docID: this.blockId,
                        val: {
                            expandIds: expandIds
                        }
                    });
                }
                // 重置层级显示状态
                if (this.resetLevelDisplay) {
                    this.resetLevelDisplay();
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
                    window.siyuan.storage[Constants.LOCAL_OUTLINE].keepExpand = false;
                } else {
                    iconElement.classList.add("block__icon--active");
                    window.siyuan.storage[Constants.LOCAL_OUTLINE].keepExpand = true;
                    this.tree.expandAll();
                }
    
                // 保存keepExpand状态到localStorage
                setStorageVal(Constants.LOCAL_OUTLINE, window.siyuan.storage[Constants.LOCAL_OUTLINE]);
                
                // 同时保存当前文档的展开状态到新的存储
                fetchPost("/api/storage/setOutlineStorage", {
                    docID: this.blockId,
                    val: {
                        expandIds: this.tree.getExpandIds()
                    }
                });
        });
        options.tab.panelElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            let isFocus = true;
            while (target && !target.isEqualNode(options.tab.panelElement)) {
                if (target.classList.contains("block__icon")) {
                    const type = target.getAttribute("data-type");
                    switch (type) {
                        case "min":
                            getDockByType("outline").toggleModel("outline", false, true);
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
        this.initLevelControl(); // 初始化层级控制

        fetchPost("/api/outline/getDocOutline", {
            id: this.blockId,
            preview: this.isPreview
        }, response => {
            this.update(response);
            // 初始化时从新的存储恢复折叠状态
            if (!this.isPreview) {
                fetchPost("/api/storage/getOutlineStorage", {
                    docID: this.blockId
                }, storageResponse => {
                    const storageData = storageResponse.data;
                    if (storageData && storageData.expandIds && !this.headerElement.querySelector('[data-type="expand"]').classList.contains("block__icon--active")) {
                        this.tree.setExpandIds(storageData.expandIds);
                    }
                });
            }
        });
    }

    /**
     * 切换同层级的所有标题的展开/折叠状态（如果有子标题的话）
     * @param element 当前点击的元素
     */
    private collapseSameLevel(element: HTMLElement) {
        if (!element) {
            return;
        }

        // 获取当前元素的层级深度
        const currentLevel = this.getElementLevel(element);
        
        // 找到所有同层级的元素
        const sameLevelElements = this.getSameLevelElements(currentLevel);
        
        // 过滤出有子元素的项
        const elementsWithChildren = sameLevelElements.filter(item => 
            item.nextElementSibling && item.nextElementSibling.tagName === "UL"
        );
        
        if (elementsWithChildren.length === 0) {
            return;
        }
        
        // 检查当前状态：如果大部分元素是展开的，则执行折叠；否则执行展开
        let expandedCount = 0;
        elementsWithChildren.forEach(item => {
            const arrowElement = item.querySelector(".b3-list-item__arrow");
            if (arrowElement && arrowElement.classList.contains("b3-list-item__arrow--open")) {
                expandedCount++;
            }
        });
        
        // 如果超过一半的元素是展开的，则折叠所有；否则展开所有
        const shouldCollapse = expandedCount > elementsWithChildren.length / 2;
        
        elementsWithChildren.forEach(item => {
            const arrowElement = item.querySelector(".b3-list-item__arrow");
            
            if (shouldCollapse) {
                // 折叠
                if (arrowElement && arrowElement.classList.contains("b3-list-item__arrow--open")) {
                    arrowElement.classList.remove("b3-list-item__arrow--open");
                    item.nextElementSibling.classList.add("fn__none");
                }
            } else {
                // 展开
                if (arrowElement && !arrowElement.classList.contains("b3-list-item__arrow--open")) {
                    arrowElement.classList.add("b3-list-item__arrow--open");
                    item.nextElementSibling.classList.remove("fn__none");
                }
            }
        });

        // 触发折叠状态变化事件，保存状态
        if (this.tree.onToggleChange) {
            this.tree.onToggleChange();
        }
        
        // 重置层级显示状态
        if (this.resetLevelDisplay) {
            this.resetLevelDisplay();
        }
    }

    /**
     * 获取元素在大纲中的层级深度
     * @param element li元素
     * @returns 层级深度（从0开始）
     */
    private getElementLevel(element: HTMLElement): number {
        let level = 0;
        let parent = element.parentElement;
        
        while (parent && !parent.classList.contains("fn__flex-1")) {
            if (parent.tagName === "UL" && !parent.classList.contains("b3-list")) {
                level++;
            }
            parent = parent.parentElement;
        }
        
        return level;
    }

    /**
     * 获取所有同层级的元素
     * @param level 目标层级
     * @returns 同层级的li元素数组
     */
    private getSameLevelElements(level: number): HTMLElement[] {
        const allListItems = this.element.querySelectorAll("li.b3-list-item");
        const sameLevelElements: HTMLElement[] = [];
        
        allListItems.forEach(item => {
            if (this.getElementLevel(item as HTMLElement) === level) {
                sameLevelElements.push(item as HTMLElement);
            }
        });
        
        return sameLevelElements;
    }

    /**
     * 初始化层级控制滑条
     */
    private initLevelControl() {
        const levelControlElement = this.headerElement.parentElement.children[2] as HTMLElement;
        const dots = levelControlElement.querySelectorAll(".outline-level-dot") as NodeListOf<HTMLElement>;
        const levelText = levelControlElement.querySelector(".outline-level-text") as HTMLElement;

        // 添加滑条样式
        if (!document.getElementById("outline-slider-style")) {
            const style = document.createElement("style");
            style.id = "outline-slider-style";
            style.textContent = `
                .outline-level-dots {
                    justify-content: space-between;
                }
                .outline-level-dot {
                    transition: all 0.2s ease;
                    position: relative;
                }
                .outline-level-dot:hover {
                    transform: scale(1.1);
                }
                .outline-level-dot.active {
                    background: var(--b3-theme-primary) !important;
                }
                .outline-level-dot:not(.active) {
                    background: var(--b3-theme-on-surface-light) !important;
                }
                .outline-level-line {
                    background: var(--b3-border-color) !important;
                }
            `;
            document.head.appendChild(style);
        }

        // 更新层级文本和点的状态
        const updateLevelDisplay = (level: number) => {
            // 更新文本显示
            if (level === 0) {
                levelText.textContent = ""; // 默认状态下不显示文字
            } else if (level === 6) {
                levelText.textContent = window.siyuan.languages.outlineExpandAll;
            } else {
                levelText.textContent = `${level}${window.siyuan.languages.outlineLevel}`;
            }
            
            // 更新点的状态
            dots.forEach((dot, index) => {
                const dotLevel = index + 1;
                if (level > 0 && dotLevel <= level) {
                    dot.classList.add("active");
                } else {
                    dot.classList.remove("active");
                }
            });
        };

        // 重置层级显示（用于文档切换或其他操作后重置）
        this.resetLevelDisplay = () => {
            updateLevelDisplay(0);
        };

        // 为每个点添加点击事件
        dots.forEach((dot) => {
            dot.addEventListener("click", () => {
                const level = parseInt(dot.getAttribute("data-level"));
                updateLevelDisplay(level);
                this.expandToLevel(level);
            });
        });

        // 初始化显示 - 默认不显示层级
        updateLevelDisplay(0);
    }

    /**
     * 展开到指定层级
     * @param targetLevel 目标层级，1-6级，6级表示全部展开
     */
    private expandToLevel(targetLevel: number) {
        if (targetLevel >= 6) {
            // 全部展开
            this.tree.expandAll();
        } else {
            // 展开到指定层级
            const allListItems = this.element.querySelectorAll("li.b3-list-item");
            
            allListItems.forEach(item => {
                const elementLevel = this.getElementLevel(item as HTMLElement);
                const arrowElement = item.querySelector(".b3-list-item__arrow");
                
                if (item.nextElementSibling && item.nextElementSibling.tagName === "UL" && arrowElement) {
                    // 新的层级映射：1级对应原来的0级，2级对应原来的1级，以此类推
                    const adjustedTargetLevel = targetLevel - 1;
                    
                    if (elementLevel < adjustedTargetLevel) {
                        // 当前层级小于目标层级，展开
                        arrowElement.classList.add("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.remove("fn__none");
                    } else {
                        // 当前层级大于等于目标层级，折叠
                        arrowElement.classList.remove("b3-list-item__arrow--open");
                        item.nextElementSibling.classList.add("fn__none");
                    }
                }
            });
        }

        // 保存状态
        if (this.tree.onToggleChange) {
            this.tree.onToggleChange();
        }
    }

    /**
     * 显示或隐藏层级控制
     */
    public toggleLevelControl(show: boolean) {
        const levelControlElement = this.headerElement.parentElement.children[2] as HTMLElement;
        if (show) {
            levelControlElement.style.display = "block";
        } else {
            levelControlElement.style.display = "none";
        }
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
                if (!this.element.contains(moveEvent.target as Element)) {
                    this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach(item => {
                        item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                    });
                    return;
                }
                if (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB || moveEvent.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB) {
                    this.element.scroll({
                        top: this.element.scrollTop + (moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB ? -Constants.SIZE_SCROLL_STEP : Constants.SIZE_SCROLL_STEP),
                        behavior: "smooth"
                    });
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
                        
                        // 保存拖拽前的折叠状态
                        const expandIdsBeforeDrag = this.tree.getExpandIds();
                        
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
                        
                        // 拖拽操作完成后恢复折叠状态
                        setTimeout(() => {
                            fetchPost("/api/storage/setOutlineStorage", {
                                docID: this.blockId,
                                val: {
                                    expandIds: expandIdsBeforeDrag
                                }
                            });
                        }, 300);
                        
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

    public updateDocTitle(ial?: IObject) {
        const docTitleElement = this.headerElement.nextElementSibling as HTMLElement;
        if (this.type === "pin") {
            if (ial) {
                let iconHTML = `${unicode2Emoji(ial.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].file, "b3-list-item__graphic", true)}`;
                if (ial.icon === Constants.ZWSP && docTitleElement.firstElementChild) {
                    iconHTML = docTitleElement.firstElementChild.outerHTML;
                }
                docTitleElement.innerHTML = `${iconHTML}
<span class="b3-list-item__text">${escapeHtml(ial.title)}</span>`;
                docTitleElement.setAttribute("title", ial.title);
                docTitleElement.classList.remove("fn__none");
                // 显示层级控制
                this.toggleLevelControl(true);
            } else {
                docTitleElement.classList.add("fn__none");
                // 隐藏层级控制
                this.toggleLevelControl(false);
            }
        } else {
            docTitleElement.classList.add("fn__none");
            // 对于local类型，根据是否有大纲内容决定是否显示层级控制
            const hasOutlineContent = this.element.querySelector("li.b3-list-item");
            this.toggleLevelControl(!!hasOutlineContent);
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
        while (currentElement && currentElement.clientHeight === 0) {
            currentElement = currentElement.parentElement.previousElementSibling as HTMLElement;
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

        // 保存当前文档的折叠状态到新的持久化存储
        if (!this.isPreview) {
            const currentExpandIds = this.tree.getExpandIds();
            fetchPost("/api/storage/setOutlineStorage", {
                docID: this.blockId,
                val: {
                    expandIds: currentExpandIds
                }
            });
        }
        
        if (typeof callbackId !== "undefined") {
            this.blockId = callbackId;
        }
        this.tree.updateData(data.data);
        
        // 重置层级显示状态
        if (this.resetLevelDisplay) {
            this.resetLevelDisplay();
        }
        
        // 根据是否有大纲内容决定是否显示层级控制
        const hasOutlineContent = data.data && data.data.length > 0;
        this.toggleLevelControl(hasOutlineContent);
        
        // 从新的持久化存储恢复折叠状态
        if (!this.isPreview) {
            fetchPost("/api/storage/getOutlineStorage", {
                docID: this.blockId
            }, storageResponse => {
                const storageData = storageResponse.data;
                if (storageData && storageData.expandIds && !this.headerElement.querySelector('[data-type="expand"]').classList.contains("block__icon--active")) {
                    this.tree.setExpandIds(storageData.expandIds);
                } else {
                    this.tree.expandAll();
                    // 保存展开全部的状态到新的存储
                    fetchPost("/api/storage/setOutlineStorage", {
                        docID: this.blockId,
                        val: {
                            expandIds: this.tree.getExpandIds()
                        }
                    });
                }
            });
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
        this.element.removeAttribute("data-loading");
    }
}
