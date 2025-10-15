import { Tab } from "../Tab";
import { Model } from "../Model";
import { Tree } from "../../util/Tree";
import { getInstanceById, setPanelFocus } from "../util";
import { getDockByType } from "../tabUtil";
import { fetchPost } from "../../util/fetch";
import { getAllModels } from "../getAll";
import { hasClosestBlock, hasClosestByClassName, hasTopClosestByClassName } from "../../protyle/util/hasClosest";
import { setStorageVal, updateHotkeyAfterTip } from "../../protyle/util/compatibility";
import { openFileById } from "../../editor/util";
import { Constants } from "../../constants";
import { MenuItem } from "../../menus/Menu";
import { escapeHtml } from "../../util/escape";
import { unicode2Emoji } from "../../emoji";
import { getPreviousBlock } from "../../protyle/wysiwyg/getBlock";
import { App } from "../../index";
import { checkFold } from "../../util/noRelyPCFunction";
import { transaction, turnsIntoTransaction } from "../../protyle/wysiwyg/transaction";
import { goHome } from "../../protyle/wysiwyg/commonHotkey";
import { Editor } from "../../editor";
import { writeText, isInAndroid, isInHarmony } from "../../protyle/util/compatibility";
import { mathRender } from "../../protyle/render/mathRender";

export class Outline extends Model {
    public tree: Tree;
    public element: HTMLElement;
    public headerElement: HTMLElement;
    public type: "pin" | "local";
    public blockId: string;
    public isPreview: boolean;
    // 筛选相关
    private searchInput: HTMLInputElement;
    private searchKeyword = "";
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
                    fetchPost("/api/block/checkBlockExist", { id: this.blockId }, existResponse => {
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
                                fetchPost("/api/block/checkBlockExist", { id: this.blockId }, existResponse => {
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
    <input class="b3-text-field search__label fn__none fn__size200" placeholder="${window.siyuan.languages.filterKeywordEnter}" />
    <span data-type="search" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.filter}"><svg><use xlink:href='#iconFilter'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="expand" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.expandAll}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.expand.custom)}">
        <svg><use xlink:href="#iconExpand"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="keepCurrentExpand" class="block__icon b3-tooltips b3-tooltips__sw${window.siyuan.storage[Constants.LOCAL_OUTLINE]?.keepCurrentExpand ? " block__icon--active" : ""}" aria-label="${window.siyuan.languages.outlineKeepCurrentExpand || "保持当前标题展开"}">
        <svg><use xlink:href="#iconFocus"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="expandLevel" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="展开层级">
        <svg><use xlink:href="#iconList"></use></svg>
    </span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.collapse}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <span class="${this.type === "local" ? "fn__none " : ""}fn__space"></span>
    <span data-type="min" class="${this.type === "local" ? "fn__none " : ""}block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="b3-list-item fn__none"></div>
<div class="fn__flex-1" style="padding: 3px 0 8px"></div>`;
        this.element = options.tab.panelElement.children[2] as HTMLElement; // 更新为第三个子元素（大纲内容）
        this.headerElement = options.tab.panelElement.firstElementChild as HTMLElement;
        // 绑定筛选输入框交互，参考 Backlink.ts
        this.searchInput = this.headerElement.querySelector("input.b3-text-field.search__label") as HTMLInputElement;
        if (this.searchInput) {
            this.searchInput.addEventListener("blur", (event: KeyboardEvent) => {
                const inputElement = event.target as HTMLInputElement;
                inputElement.classList.add("fn__none");
                const filterIconElement = inputElement.nextElementSibling as HTMLElement; // search 图标
                const val = inputElement.value.trim();
                if (val) {
                    filterIconElement.classList.add("block__icon--active");
                    filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter + " " + val);
                } else {
                    filterIconElement.classList.remove("block__icon--active");
                    filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter);
                    // 若之前有筛选，且清空，则恢复
                    if (this.searchKeyword) {
                        this.clearFilter();
                    }
                }
            });
            this.searchInput.addEventListener("keydown", (event: KeyboardEvent) => {
                if (!event.isComposing && event.key === "Enter") {
                    const kw = this.searchInput.value.trim();
                    if (kw) {
                        this.applyFilter(kw);
                    } else {
                        this.clearFilter();
                    }
                }
            });
            this.searchInput.addEventListener("input", (event: KeyboardEvent) => {
                const inputElement = event.target as HTMLInputElement;
                if (inputElement.value === "") {
                    inputElement.classList.remove("search__input--block");
                } else {
                    inputElement.classList.add("search__input--block");
                }
            });
        }
        this.tree = new Tree({
            element: options.tab.panelElement.children[2] as HTMLElement, // 使用第三个子元素作为树容器
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
            rightClick: (element: HTMLElement, event: MouseEvent) => {
                // 右键菜单
                event.preventDefault();
                event.stopPropagation();
                this.showContextMenu(element, event);
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
            }
        });
        // 为了快捷键的 dispatch
        options.tab.panelElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            this.tree.collapseAll();
        });

        // 普通的全部展开按钮
        options.tab.panelElement.querySelector('[data-type="expand"]').addEventListener("click", () => {
            this.tree.expandAll();
            // 保存展开状态
            if (!this.isPreview) {
                fetchPost("/api/storage/setOutlineStorage", {
                    docID: this.blockId,
                    val: {
                        expandIds: this.tree.getExpandIds()
                    }
                });
            }
        });

        // 保持当前标题展开功能
        options.tab.panelElement.querySelector('[data-type="keepCurrentExpand"]').addEventListener("click", (event: MouseEvent & {
            target: Element
        }) => {
            const iconElement = hasClosestByClassName(event.target, "block__icon");
            if (!iconElement) {
                return;
            }

            // 确保存储对象存在
            if (!window.siyuan.storage[Constants.LOCAL_OUTLINE]) {
                window.siyuan.storage[Constants.LOCAL_OUTLINE] = {};
            }

            if (iconElement.classList.contains("block__icon--active")) {
                iconElement.classList.remove("block__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = false;
            } else {
                iconElement.classList.add("block__icon--active");
                window.siyuan.storage[Constants.LOCAL_OUTLINE].keepCurrentExpand = true;
                // 立即展开到真正的当前标题
                this.expandToCurrentHeading();
            }

            // 保存keepCurrentExpand状态到localStorage
            setStorageVal(Constants.LOCAL_OUTLINE, window.siyuan.storage[Constants.LOCAL_OUTLINE]);
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
                        case "search":
                            // 显示输入框并选中
                            if (this.searchInput) {
                                this.searchInput.classList.remove("fn__none");
                                this.searchInput.select();
                            }
                            break;
                        case "expandLevel":
                            this.showExpandLevelMenu(event);
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
            // 初始化时从新的存储恢复折叠状态
            if (!this.isPreview) {
                fetchPost("/api/storage/getOutlineStorage", {
                    docID: this.blockId
                }, storageResponse => {
                    const storageData = storageResponse.data;
                    if (storageData && storageData.expandIds) {
                        this.tree.setExpandIds(storageData.expandIds);
                    }
                    // 若存在筛选关键词，初始化后应用一次筛选
                    if (this.searchKeyword) {
                        this.applyFilter(this.searchKeyword);
                    }
                });
            }
        });
    }

    /**
     * 切换同层级的所有标题的展开/折叠状态（基于标题级别而不是DOM层级）
     * @param element 当前点击的元素
     */
    private collapseSameLevel(element: HTMLElement) {
        if (!element) {
            return;
        }

        // 获取当前元素的标题级别
        const currentHeadingLevel = this.getHeadingLevel(element);
        if (currentHeadingLevel === 0) {
            return; // 如果不是有效的标题，直接返回
        }

        // 获取所有相同标题级别的元素
        const allListItems = this.element.querySelectorAll("li.b3-list-item");
        const sameLevelElements: HTMLElement[] = [];

        allListItems.forEach(item => {
            const headingLevel = this.getHeadingLevel(item as HTMLElement);
            if (headingLevel === currentHeadingLevel) {
                sameLevelElements.push(item as HTMLElement);
            }
        });

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
     * 展开到当前标题路径
     */
    private expandToCurrentHeading() {
        // 获取当前真正的标题ID
        this.getCurrentHeadingId((currentHeadingId) => {
            if (currentHeadingId) {
                this.expandToHeadingByIdSmart(currentHeadingId);
            }
        });
    }

    /**
     * 智能展开到指定标题ID，保持兄弟分支的原有状态
     */
    private expandToHeadingByIdSmart(headingId: string) {
        // 确保目标标题在大纲中可见
        this.ensureHeadingVisibleSmart(headingId);

        // 设置为当前焦点（这会触发自动展开）
        this.setCurrentById(headingId);
    }

    /**
     * 智能确保指定标题在大纲中可见（展开其所有父级路径，但保持兄弟分支状态）
     */
    private ensureHeadingVisibleSmart(headingId: string) {
        const targetElement = this.element.querySelector(`.b3-list-item[data-node-id="${headingId}"]`) as HTMLElement;
        if (targetElement) {
            this.expandPathToElement(targetElement);

            // 额外检查：确保目标元素真的可见
            setTimeout(() => {
                const checkElement = this.element.querySelector(`.b3-list-item[data-node-id="${headingId}"]`) as HTMLElement;
                if (checkElement && checkElement.offsetParent === null) {
                    // 如果元素仍然不可见，再次尝试展开路径
                    this.expandPathToElement(checkElement);
                }
            }, 50);
        }
    }

    /**
     * 获取当前真正的标题ID
     */
    private getCurrentHeadingId(callback: (id: string) => void) {
        // 首先尝试从编辑器获取当前光标位置的块
        let currentBlockId: string = null;

        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                const selection = getSelection();
                if (selection.rangeCount > 0) {
                    const blockElement = hasClosestBlock(selection.getRangeAt(0).startContainer);
                    if (blockElement) {
                        currentBlockId = blockElement.getAttribute("data-node-id");
                        return true;
                    }
                }
            }
        });

        if (currentBlockId) {
            // 如果当前块就是标题，直接使用
            const currentBlockElement = document.querySelector(`[data-node-id="${currentBlockId}"]`);
            if (currentBlockElement && currentBlockElement.getAttribute("data-type") === "NodeHeading") {
                callback(currentBlockId);
                return;
            }

            // 如果当前块不是标题，查找前面最近的标题
            let previousElement = getPreviousBlock(currentBlockElement as HTMLElement);
            while (previousElement) {
                if (previousElement.getAttribute("data-type") === "NodeHeading") {
                    callback(previousElement.getAttribute("data-node-id"));
                    return;
                }
                previousElement = getPreviousBlock(previousElement);
            }

            // 如果没有找到前面的标题，通过API获取面包屑
            fetchPost("/api/block/getBlockBreadcrumb", {
                id: currentBlockId,
                excludeTypes: []
            }, (response) => {
                const headingItem = response.data.reverse().find((item: IBreadcrumb) => {
                    return item.type === "NodeHeading";
                });
                if (headingItem) {
                    callback(headingItem.id);
                }
            });
        } else {
            // 如果无法获取当前块，使用现有的focus元素
            const currentElement = this.element.querySelector(".b3-list-item--focus");
            if (currentElement) {
                callback(currentElement.getAttribute("data-node-id"));
            }
        }
    }

    /**
     * 展开到指定标题ID
     */
    private expandToHeadingById(headingId: string) {
        // 确保目标标题在大纲中可见
        this.ensureHeadingVisible(headingId);

        // 设置为当前焦点（这会触发自动展开）
        this.setCurrentById(headingId);
    }

    /**
     * 确保指定标题在大纲中可见（展开其所有父级路径）
     */
    private ensureHeadingVisible(headingId: string) {
        const targetElement = this.element.querySelector(`.b3-list-item[data-node-id="${headingId}"]`) as HTMLElement;
        if (targetElement) {
            this.expandPathToElement(targetElement);
        }
    }

    /**
     * 展开到指定元素的路径，智能处理兄弟分支的折叠状态
     */
    private expandPathToElement(element: HTMLElement) {
        if (!element) {
            return;
        }

        // 收集所有需要展开的ul元素路径，以及它们的折叠状态
        const pathToExpand: Array<{ ul: HTMLElement, wasCollapsed: boolean, parentLi: HTMLElement }> = [];
        let current = element.parentElement; // 从父级ul开始

        while (current && !current.classList.contains("fn__flex-1")) {
            if (current.tagName === "UL" && !current.classList.contains("b3-list")) {
                // 这是一个可折叠的ul元素
                const parentLi = current.previousElementSibling as HTMLElement;
                const wasCollapsed = current.classList.contains("fn__none");

                pathToExpand.push({
                    ul: current,
                    wasCollapsed: wasCollapsed,
                    parentLi: parentLi
                });
            }
            current = current.parentElement;
        }

        // 从最外层开始展开，确保每一层都能正确展开
        pathToExpand.reverse().forEach((pathItem, index) => {
            const { ul, wasCollapsed, parentLi } = pathItem;

            if (ul.classList.contains("fn__none")) {
                ul.classList.remove("fn__none");

                // 设置箭头状态
                if (parentLi && parentLi.classList.contains("b3-list-item")) {
                    const arrowElement = parentLi.querySelector(".b3-list-item__arrow");
                    if (arrowElement && !arrowElement.classList.contains("b3-list-item__arrow--open")) {
                        arrowElement.classList.add("b3-list-item__arrow--open");
                    }
                }
            }

            // 如果这个节点原本是折叠的，需要折叠其他分支
            if (wasCollapsed && parentLi) {
                this.collapseSiblingsExceptPath(parentLi, pathToExpand.slice(index + 1));
            }
        });

        // 保存展开状态
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
     * 折叠指定li下的所有兄弟分支，除了通往目标的路径
     * @param parentLi 父级li元素
     * @param targetPath 目标路径上的ul元素列表
     */
    private collapseSiblingsExceptPath(parentLi: HTMLElement, targetPath: Array<{ ul: HTMLElement, wasCollapsed: boolean, parentLi: HTMLElement }>) {
        // 获取父li下的直接ul子元素
        const directChildUl = parentLi.nextElementSibling;
        if (!directChildUl || directChildUl.tagName !== "UL") {
            return;
        }

        // 获取目标路径上的下一个ul（如果存在）
        const nextTargetUl = targetPath.length > 0 ? targetPath[0].ul : null;

        // 遍历所有直接子li元素
        const childLiElements = directChildUl.children;
        for (let i = 0; i < childLiElements.length; i++) {
            const childLi = childLiElements[i] as HTMLElement;
            if (!childLi.classList.contains("b3-list-item")) {
                continue;
            }

            // 获取这个li的子ul
            const childUl = childLi.nextElementSibling;
            if (childUl && childUl.tagName === "UL") {
                // 如果这个ul不是目标路径上的ul，则折叠它
                if (childUl !== nextTargetUl) {
                    if (!childUl.classList.contains("fn__none")) {
                        childUl.classList.add("fn__none");

                        // 更新箭头状态
                        const arrowElement = childLi.querySelector(".b3-list-item__arrow");
                        if (arrowElement && arrowElement.classList.contains("b3-list-item__arrow--open")) {
                            arrowElement.classList.remove("b3-list-item__arrow--open");
                        }
                    }
                }
            }
        }
    }

    /**
     * 获取标题元素的实际标题级别（H1=1, H2=2, 等等）
     * @param element li元素
     * @returns 标题级别（1-6）
     */
    private getHeadingLevel(element: HTMLElement): number {
        const subtype = element.getAttribute("data-subtype");
        if (!subtype) {
            return 0;
        }

        // 从data-subtype属性中提取标题级别（h1=1, h2=2, h3=3, 等等）
        const match = subtype.match(/^h(\d+)$/);
        if (match) {
            return parseInt(match[1], 10);
        }

        return 0;
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
            const allListItems = this.element.querySelectorAll("li.b3-list-item");

            allListItems.forEach(item => {
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

        // 保存状态
        if (this.tree.onToggleChange) {
            this.tree.onToggleChange();
        }
    }

    /**
     * 显示展开层级菜单
     */
    private showExpandLevelMenu(event: MouseEvent) {
        window.siyuan.menus.menu.remove();
        for (let i = 1; i <= 6; i++) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: `iconH${i}`,
                label: window.siyuan.languages[`heading${i}`],
                click: () => this.expandToLevel(i)
            }).element);
        }
        window.siyuan.menus.menu.popup({
            x: event.clientX - 11,
            y: event.clientY + 11,
            w: 12
        });
        return window.siyuan.menus.menu;
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
            } else {
                docTitleElement.classList.add("fn__none");
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

        // 如果启用了保持当前标题展开功能，先确保目标标题可见
        if (window.siyuan.storage[Constants.LOCAL_OUTLINE]?.keepCurrentExpand) {
            this.ensureHeadingVisibleSmart(id);
        }

        let currentElement = this.element.querySelector(`.b3-list-item[data-node-id="${id}"]`) as HTMLElement;

        // 如果元素仍然不可见，尝试多次查找和展开
        let retryCount = 0;
        const maxRetries = 3;

        const trySetCurrent = () => {
            currentElement = this.element.querySelector(`.b3-list-item[data-node-id="${id}"]`) as HTMLElement;

            while (currentElement && currentElement.clientHeight === 0 && retryCount < maxRetries) {
                // 如果启用了保持当前标题展开功能，再次尝试展开路径
                if (window.siyuan.storage[Constants.LOCAL_OUTLINE]?.keepCurrentExpand) {
                    this.expandPathToElement(currentElement);
                }
                currentElement = currentElement.parentElement?.previousElementSibling as HTMLElement;
                retryCount++;
            }

            if (currentElement) {
                currentElement.classList.add("b3-list-item--focus");

                const elementRect = this.element.getBoundingClientRect();
                this.element.scrollTop = this.element.scrollTop + (currentElement.getBoundingClientRect().top - (elementRect.top + elementRect.height / 2));
            } else if (retryCount < maxRetries && window.siyuan.storage[Constants.LOCAL_OUTLINE]?.keepCurrentExpand) {
                // 如果还没找到元素且启用了展开功能，延迟重试
                setTimeout(() => {
                    retryCount++;
                    this.ensureHeadingVisibleSmart(id);
                    setTimeout(trySetCurrent, 50);
                }, 50);
            }
        };

        trySetCurrent();
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

        // 从新的持久化存储恢复折叠状态
        if (!this.isPreview) {
            fetchPost("/api/storage/getOutlineStorage", {
                docID: this.blockId
            }, storageResponse => {
                const storageData = storageResponse.data;
                if (storageData && storageData.expandIds) {
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
                // 若当前存在筛选词，更新后重新应用筛选
                if (this.searchKeyword) {
                    this.applyFilter(this.searchKeyword);
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

    /**
     * 应用大纲筛选
     */
    private applyFilter(keyword: string) {
        const kw = keyword.trim();
        if (!kw) {
            this.clearFilter();
            return;
        }
        this.searchKeyword = kw;
        // 首次筛选时记录折叠状态
        if (!this.preFilterExpandIds) {
            try {
                this.preFilterExpandIds = this.tree.getExpandIds();
            } catch (e) {
                this.preFilterExpandIds = [];
            }
        }

        // 递归过滤 DOM
        const rootUL = this.element.querySelector("ul.b3-list");
        if (!rootUL) return;

        const kwLower = kw.toLowerCase();
        const matchedItems = new Set<HTMLElement>(); // 记录所有命中的标题

        // 第一遍：收集所有命中的项目
        const collectMatches = (ul: Element) => {
            ul.querySelectorAll("li.b3-list-item").forEach(li => {
                const textEl = (li as HTMLElement).querySelector(".b3-list-item__text") as HTMLElement;
                const textContent = (textEl?.textContent || "").trim().toLowerCase();
                if (textContent.includes(kwLower)) {
                    matchedItems.add(li as HTMLElement);
                }
            });
        };
        collectMatches(rootUL);

        // 展开所有命中项的父级路径
        matchedItems.forEach(matchedLi => {
            this.expandPathToElement(matchedLi);
        });

        const processUL = (ul: Element): { hasMatch: boolean, hasChildMatch: boolean } => {
            let hasMatch = false;
            let hasChildMatch = false;
            const children = ul.querySelectorAll(":scope > li.b3-list-item");

            children.forEach((li) => {
                const textEl = (li as HTMLElement).querySelector(".b3-list-item__text") as HTMLElement;
                const textContent = (textEl?.textContent || "").trim().toLowerCase();
                const selfMatch = textContent.includes(kwLower);
                const next = (li as HTMLElement).nextElementSibling;

                let childResult = { hasMatch: false, hasChildMatch: false };
                if (next && next.tagName === "UL") {
                    childResult = processUL(next);
                }

                if (selfMatch) {
                    // 当前标题命中
                    (li as HTMLElement).style.display = "";
                    hasMatch = true;

                    if (next && next.tagName === "UL") {
                        (next as HTMLElement).style.display = "";

                        if (childResult.hasMatch || childResult.hasChildMatch) {
                            // 子项也有命中，保持展开状态，但隐藏未命中的子项由子级处理
                            const arrow = li.querySelector(".b3-list-item__arrow");
                            if (arrow) {
                                arrow.classList.add("b3-list-item__arrow--open");
                            }
                        } else {
                            // 子项无命中，折叠所有子项但保持可展开
                            const arrow = li.querySelector(".b3-list-item__arrow");
                            if (arrow) {
                                arrow.classList.remove("b3-list-item__arrow--open");
                            }
                            // 折叠但不完全隐藏，保持子项可访问性
                            next.classList.add("fn__none");
                            // 确保所有子项内容保持可见状态，用户可以手动展开查看
                            next.querySelectorAll("li.b3-list-item").forEach(childLi => {
                                (childLi as HTMLElement).style.display = "";
                            });
                            next.querySelectorAll("ul").forEach(childUl => {
                                (childUl as HTMLElement).style.display = "";
                                // 移除子ul的fn__none，保证嵌套结构的可访问性
                                childUl.classList.remove("fn__none");
                            });
                        }
                    }
                } else if (childResult.hasMatch || childResult.hasChildMatch) {
                    // 当前标题未命中，但子级有命中
                    (li as HTMLElement).style.display = "";
                    hasChildMatch = true;

                    if (next && next.tagName === "UL") {
                        (next as HTMLElement).style.display = "";
                        // 展开以显示命中的子项
                        const arrow = li.querySelector(".b3-list-item__arrow");
                        if (arrow) {
                            arrow.classList.add("b3-list-item__arrow--open");
                        }
                    }
                } else {
                    // 当前标题和子级都未命中，隐藏
                    (li as HTMLElement).style.display = "none";
                    if (next && next.tagName === "UL") {
                        (next as HTMLElement).style.display = "none";
                    }
                }
            });

            return { hasMatch, hasChildMatch };
        };

        processUL(rootUL);
    }    /**
     * 清除大纲筛选并恢复展开状态
     */
    private clearFilter() {
        this.searchKeyword = "";
        // 还原 display
        this.element.querySelectorAll("li.b3-list-item, .fn__flex-1 ul").forEach((el) => {
            (el as HTMLElement).style.display = "";
        });
        // 恢复折叠状态
        if (this.preFilterExpandIds) {
            this.tree.setExpandIds(this.preFilterExpandIds);
        }
        this.preFilterExpandIds = null;
        // 复位图标状态
        const filterIconElement = this.headerElement.querySelector('[data-type="search"]') as HTMLElement;
        if (filterIconElement) {
            filterIconElement.classList.remove("block__icon--active");
            filterIconElement.setAttribute("aria-label", window.siyuan.languages.filter);
        }
    }

    /**
     * 显示右键菜单
     */
    private showContextMenu(element: HTMLElement, event: MouseEvent) {
        if (this.isPreview) {
            return; // 预览模式下不显示右键菜单
        }

        const id = element.getAttribute("data-node-id");
        const subtype = element.getAttribute("data-subtype");
        if (!id || !subtype) {
            return;
        }

        const currentLevel = this.getHeadingLevel(element);
        
        window.siyuan.menus.menu.remove();

        // 升级
        if (currentLevel > 1) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconUp",
                label: "升级",
                click: () => this.upgradeHeading(element)
            }).element);
        }

        // 降级
        if (currentLevel < 6) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconDown", 
                label: "降级",
                click: () => this.downgradeHeading(element)
            }).element);
        }

        // 带子标题转换
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

        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);

        // 在前面插入同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconBefore",
            label: "在前面插入同级标题",
            click: () => this.insertHeadingBefore(element)
        }).element);

        // 在后面插入同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAfter",
            label: "在后面插入同级标题", 
            click: () => this.insertHeadingAfter(element)
        }).element);

        // 添加子标题
        if (currentLevel < 6) { // 只有当前级别小于6时才能添加子标题
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconAdd",
                label: "添加子标题",
                click: () => this.addChildHeading(element)
            }).element);
        }

        window.siyuan.menus.menu.append(new MenuItem({ type: "separator" }).element);


        // 复制带子标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconCopy",
            label: `${window.siyuan.languages.copy} ${window.siyuan.languages.headings1}`,
            click: () => this.copyHeadingWithChildren(element)
        }).element);

        // 剪切带子标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconCut",
            label: `${window.siyuan.languages.cut} ${window.siyuan.languages.headings1}`,
            click: () => this.cutHeadingWithChildren(element)
        }).element);


        // 删除
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconTrashcan",
            label: `${window.siyuan.languages.delete} ${window.siyuan.languages.headings1}`,
            click: () => this.deleteHeading(element)
        }).element);

        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);

        // 展开子标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconExpand",
            label: "展开子标题",
            click: () => this.expandChildren(element)
        }).element);

        // 折叠子标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconContract",
            label: "折叠子标题",
            click: () => this.collapseChildren(element)
        }).element);

        // 展开同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconExpand",
            label: "展开同级标题",
            click: () => this.expandSameLevel(element)
        }).element);

        // 折叠同级标题
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconContract", 
            label: "折叠同级标题",
            click: () => this.collapseSameLevel(element)
        }).element);

        // 全部展开
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconExpand",
            label: "全部展开",
            click: () => {
                this.tree.expandAll();
                if (!this.isPreview) {
                    fetchPost("/api/storage/setOutlineStorage", {
                        docID: this.blockId,
                        val: {
                            expandIds: this.tree.getExpandIds()
                        }
                    });
                }
            }
        }).element);

        // 全部折叠
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconContract",
            label: "全部折叠",
            click: () => this.tree.collapseAll()
        }).element);

        window.siyuan.menus.menu.popup({
            x: event.clientX,
            y: event.clientY
        });
    }

    /**
     * 升级标题
     */
    private upgradeHeading(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        const currentLevel = this.getHeadingLevel(element);
        
        if (currentLevel <= 1) {
            return;
        }

        // 找到编辑器实例和文档中的标题元素
        let editor: any;
        let blockElement: HTMLElement;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                editor = editItem.editor.protyle;
                blockElement = editor.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                return true;
            }
        });

        if (!editor || !blockElement) {
            return;
        }

        // 使用turnsIntoTransaction来变更标题级别
        turnsIntoTransaction({
            protyle: editor,
            selectsElement: [blockElement],
            type: "Blocks2Hs",
            level: currentLevel - 1
        });
    }

    /**
     * 降级标题
     */
    private downgradeHeading(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        const currentLevel = this.getHeadingLevel(element);
        
        if (currentLevel >= 6) {
            return;
        }

        // 找到编辑器实例和文档中的标题元素
        let editor: any;
        let blockElement: HTMLElement;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                editor = editItem.editor.protyle;
                blockElement = editor.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                return true;
            }
        });

        if (!editor || !blockElement) {
            return;
        }

        // 使用turnsIntoTransaction来变更标题级别
        turnsIntoTransaction({
            protyle: editor,
            selectsElement: [blockElement],
            type: "Blocks2Hs",
            level: currentLevel + 1
        });
    }

    /**
     * 在前面插入同级标题
     */
    private insertHeadingBefore(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        const currentLevel = this.getHeadingLevel(element);
        const headingPrefix = "#".repeat(currentLevel) + " ";

        fetchPost("/api/block/insertBlock", {
            data: headingPrefix,
            dataType: "markdown",
            nextID: id
        }, (response) => {
            if (response.code === 0) {
                // 插入成功后，可以选择聚焦到新插入的标题
                const newId = response.data[0].doOperations[0].id;
                openFileById({
                    app: this.app,
                    id: newId,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE]
                });
            }
        });
    }

    /**
     * 在后面插入同级标题
     */
    private insertHeadingAfter(element: HTMLElement) {
        const currentLevel = this.getHeadingLevel(element);
        const headingPrefix = "#".repeat(currentLevel) + " ";

        // 获取父节点ID，如果当前标题是顶级标题，使用文档根ID
        const parentElement = element.parentElement;
        let parentID = this.blockId; // 默认为文档根ID
        
        if (parentElement && parentElement.tagName === "UL") {
            const parentLi = parentElement.previousElementSibling;
            if (parentLi && parentLi.classList.contains("b3-list-item")) {
                parentID = parentLi.getAttribute("data-node-id");
            }
        }

        fetchPost("/api/block/appendBlock", {
            data: headingPrefix,
            dataType: "markdown", 
            parentID: parentID
        }, (response) => {
            if (response.code === 0) {
                // 插入成功后，可以选择聚焦到新插入的标题
                const newId = response.data[0].doOperations[0].id;
                openFileById({
                    app: this.app,
                    id: newId,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE]
                });
            }
        });
    }

    /**
     * 删除标题
     */
    private deleteHeading(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        
        // 找到编辑器实例
        let editor: any;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                editor = editItem.editor.protyle;
                return true;
            }
        });

        if (!editor) {
            return;
        }

        fetchPost("/api/block/getHeadingDeleteTransaction", {
            id: id,
        }, (response) => {
            response.data.doOperations.forEach((operation: any) => {
                editor.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                    itemElement.remove();
                });
            });
            transaction(editor, response.data.doOperations, response.data.undoOperations);
        });
    }

    /**
     * 展开子标题
     */
    private expandChildren(element: HTMLElement) {
        const nextElement = element.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            const arrowElement = element.querySelector(".b3-list-item__arrow");
            if (arrowElement) {
                arrowElement.classList.add("b3-list-item__arrow--open");
                nextElement.classList.remove("fn__none");
                
                // 递归展开所有子元素
                const expandAllChildren = (ul: Element) => {
                    ul.querySelectorAll(":scope > li.b3-list-item").forEach(li => {
                        const childUl = li.nextElementSibling;
                        if (childUl && childUl.tagName === "UL") {
                            const childArrow = li.querySelector(".b3-list-item__arrow");
                            if (childArrow) {
                                childArrow.classList.add("b3-list-item__arrow--open");
                                childUl.classList.remove("fn__none");
                                expandAllChildren(childUl);
                            }
                        }
                    });
                };
                expandAllChildren(nextElement);

                // 保存展开状态
                if (this.tree.onToggleChange) {
                    this.tree.onToggleChange();
                }
            }
        }
    }

    /**
     * 折叠子标题
     */
    private collapseChildren(element: HTMLElement) {
        const nextElement = element.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            const arrowElement = element.querySelector(".b3-list-item__arrow");
            if (arrowElement) {
                arrowElement.classList.remove("b3-list-item__arrow--open");
                nextElement.classList.add("fn__none");

                // 保存折叠状态
                if (this.tree.onToggleChange) {
                    this.tree.onToggleChange();
                }
            }
        }
    }

    /**
     * 展开同级标题 - 基于标题级别而不是DOM层级
     */
    private expandSameLevel(element: HTMLElement) {
        const currentHeadingLevel = this.getHeadingLevel(element);
        if (currentHeadingLevel === 0) {
            return; // 如果不是有效的标题，直接返回
        }

        // 获取所有相同标题级别的元素
        const allListItems = this.element.querySelectorAll("li.b3-list-item");
        const sameLevelElements: HTMLElement[] = [];

        allListItems.forEach(item => {
            const headingLevel = this.getHeadingLevel(item as HTMLElement);
            if (headingLevel === currentHeadingLevel) {
                sameLevelElements.push(item as HTMLElement);
            }
        });

        // 检查当前状态：如果大部分同级标题是展开的，则折叠；否则展开
        let expandedCount = 0;
        const elementsWithChildren = sameLevelElements.filter(item => {
            const nextElement = item.nextElementSibling;
            return nextElement && nextElement.tagName === "UL";
        });

        elementsWithChildren.forEach(item => {
            const arrowElement = item.querySelector(".b3-list-item__arrow");
            if (arrowElement && arrowElement.classList.contains("b3-list-item__arrow--open")) {
                expandedCount++;
            }
        });

        // 如果超过一半的元素是展开的，则折叠所有；否则展开所有
        const shouldExpand = expandedCount <= elementsWithChildren.length / 2;

        elementsWithChildren.forEach(item => {
            const nextElement = item.nextElementSibling;
            const arrowElement = item.querySelector(".b3-list-item__arrow");
            
            if (arrowElement && nextElement && nextElement.tagName === "UL") {
                if (shouldExpand) {
                    // 展开
                    if (!arrowElement.classList.contains("b3-list-item__arrow--open")) {
                        arrowElement.classList.add("b3-list-item__arrow--open");
                        nextElement.classList.remove("fn__none");
                    }
                } else {
                    // 折叠
                    if (arrowElement.classList.contains("b3-list-item__arrow--open")) {
                        arrowElement.classList.remove("b3-list-item__arrow--open");
                        nextElement.classList.add("fn__none");
                    }
                }
            }
        });

        // 保存展开状态
        if (this.tree.onToggleChange) {
            this.tree.onToggleChange();
        }
    }

    /**
     * 复制标题带子标题
     */
    private copyHeadingWithChildren(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        if (!id) {
            return;
        }

        // 找到编辑器实例
        let editor: any;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                editor = editItem.editor.protyle;
                return true;
            }
        });

        if (!editor) {
            return;
        }

        fetchPost("/api/block/getHeadingChildrenDOM", {
            id: id, 
            removeFoldAttr: false
        }, (response) => {
            if (isInAndroid()) {
                window.JSAndroid.writeHTMLClipboard(editor.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
            } else if (isInHarmony()) {
                window.JSHarmony.writeHTMLClipboard(editor.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
            } else {
                writeText(response.data + Constants.ZWSP);
            }
        });
    }

    /**
     * 剪切标题带子标题
     */
    private cutHeadingWithChildren(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        if (!id) {
            return;
        }

        // 找到编辑器实例
        let editor: any;
        getAllModels().editor.find(editItem => {
            if (editItem.editor.protyle.block.rootID === this.blockId) {
                editor = editItem.editor.protyle;
                return true;
            }
        });

        if (!editor) {
            return;
        }

        fetchPost("/api/block/getHeadingChildrenDOM", {
            id: id, 
            removeFoldAttr: false
        }, (response) => {
            if (isInAndroid()) {
                window.JSAndroid.writeHTMLClipboard(editor.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
            } else if (isInHarmony()) {
                window.JSHarmony.writeHTMLClipboard(editor.lute.BlockDOM2StdMd(response.data).trimEnd(), response.data + Constants.ZWSP);
            } else {
                writeText(response.data + Constants.ZWSP);
            }
            
            // 复制完成后删除标题及其子标题
            fetchPost("/api/block/getHeadingDeleteTransaction", {
                id: id,
            }, (response) => {
                response.data.doOperations.forEach((operation: any) => {
                    editor.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                        itemElement.remove();
                    });
                });
                transaction(editor, response.data.doOperations, response.data.undoOperations);
            });
        });
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
                // 找到编辑器实例
                let editor: any;
                getAllModels().editor.find(editItem => {
                    if (editItem.editor.protyle.block.rootID === this.blockId) {
                        editor = editItem.editor.protyle;
                        return true;
                    }
                });

                if (!editor) {
                    return;
                }

                fetchPost("/api/block/getHeadingLevelTransaction", {
                    id,
                    level
                }, (response) => {
                    response.data.doOperations.forEach((operation: any, index: number) => {
                        editor.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            itemElement.outerHTML = operation.data;
                        });
                        // 使用 outer 后元素需要重新查询
                        editor.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((itemElement: HTMLElement) => {
                            mathRender(itemElement);
                        });
                        if (index === 0) {
                            const focusElement = editor.wysiwyg.element.querySelector(`[data-node-id="${operation.id}"]`);
                            if (focusElement) {
                                focusElement.scrollIntoView({behavior: "smooth", block: "center"});
                            }
                        }
                    });
                    transaction(editor, response.data.doOperations, response.data.undoOperations);
                });
            }
        };
    }

    /**
     * 添加子标题
     */
    private addChildHeading(element: HTMLElement) {
        const id = element.getAttribute("data-node-id");
        if (!id) {
            return;
        }

        const currentLevel = this.getHeadingLevel(element);
        const childLevel = Math.min(currentLevel + 1, 6); // 子标题级别比当前标题高一级，最大到H6
        const headingPrefix = "#".repeat(childLevel) + " ";

        // 使用当前标题作为父标题，在其内部添加子标题
        fetchPost("/api/block/appendBlock", {
            data: headingPrefix,
            dataType: "markdown",
            parentID: id
        }, (response) => {
            if (response.code === 0 && response.data && response.data.length > 0) {
                // 确保父标题保持展开状态 - 使用expandIds方式
                const currentExpandIds = this.tree.getExpandIds();
                if (!currentExpandIds.includes(id)) {
                    currentExpandIds.push(id);
                    this.tree.setExpandIds(currentExpandIds);
                    
                    // 保存展开状态到持久化存储
                    if (!this.isPreview) {
                        fetchPost("/api/storage/setOutlineStorage", {
                            docID: this.blockId,
                            val: {
                                expandIds: currentExpandIds
                            }
                        });
                    }
                }
                
                // 插入成功后，聚焦到新插入的标题
                const newId = response.data[0].doOperations[0].id;
                openFileById({
                    app: this.app,
                    id: newId,
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_OUTLINE]
                });
            }
        });
    }
}
