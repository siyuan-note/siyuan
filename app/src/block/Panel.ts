import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Protyle} from "../protyle";
import {genUUID} from "../util/genID";
import {setPosition} from "../util/setPosition";
import {hideElements} from "../protyle/ui/hideElements";
import {Constants} from "../constants";
/// #if !BROWSER
import {openNewWindowById} from "../window/openNewWindow";
/// #endif
/// #if !MOBILE
import {moveResize} from "../dialog/moveResize";
import {openFileById} from "../editor/util";
/// #endif
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";
import {App} from "../index";
import {resize} from "../protyle/util/resize";
import {checkFold} from "../util/noRelyPCFunction";
import {updateHotkeyAfterTip} from "../protyle/util/compatibility";
import {getRangeByPoint, focusByRange} from "../protyle/util/selection";

export class BlockPanel {
    public element: HTMLElement;
    public targetElement: HTMLElement;
    public refDefs: IRefDefs[];
    public id: string;
    private app: App;
    public x: number;
    public y: number;
    private isBacklink: boolean;
    public editors: Protyle[] = [];
    private observerResize: ResizeObserver;
    private observerLoad: IntersectionObserver;
    private originalRefBlockIDs: IObject;
    private clickInfo?: {  // 🔑 存储点击位置信息
        clientX: number,
        clientY: number,
        targetRect: DOMRect,
        relativeX: number,
        relativeY: number
    };
    // 添加嵌入块模式的事件处理器
    private scrollHandler = () => {
        if (this.element && this.element.classList.contains("block__popover--embed")) {
            // 🔑 直接同步执行，确保零延迟跟随
            this.updateEmbedPosition();
        }
    };
    private resizeHandler = () => {
        if (this.element && this.element.classList.contains("block__popover--embed")) {
            this.updateEmbedPosition();
        }
    };

    // x,y 和 targetElement 二选一必传
    constructor(options: {
        app: App,
        targetElement?: HTMLElement,
        refDefs: IRefDefs[]
        isBacklink: boolean,
        originalRefBlockIDs?: IObject,  // isBacklink 为 true 时有效
        x?: number,
        y?: number,
        clickInfo?: {  // 🔑 新增：点击位置信息
            clientX: number,
            clientY: number,
            targetRect: DOMRect,
            relativeX: number,
            relativeY: number
        }
    }) {
        this.id = genUUID();
        this.targetElement = options.targetElement;
        this.refDefs = options.refDefs;
        this.app = options.app;
        this.x = options.x;
        this.y = options.y;
        this.isBacklink = options.isBacklink;
        this.originalRefBlockIDs = options.originalRefBlockIDs;
        this.clickInfo = options.clickInfo;  // 🔑 保存点击位置信息

        this.element = document.createElement("div");
        this.element.classList.add("block__popover");

        const parentElement = hasClosestByClassName(this.targetElement, "block__popover", true);
        let level = 1;
        if (parentElement) {
            this.element.setAttribute("data-oid", parentElement.getAttribute("data-oid"));
            level = parseInt(parentElement.getAttribute("data-level")) + 1;
        } else {
            this.element.setAttribute("data-oid", this.refDefs[0].refID);
        }
        // 移除同层级其他更高级的 block popover
        this.element.setAttribute("data-level", level.toString());
        for (let i = 0; i < window.siyuan.blockPanels.length; i++) {
            const item = window.siyuan.blockPanels[i];
            if (item.element.getAttribute("data-pin") === "false" &&
                item.targetElement && parseInt(item.element.getAttribute("data-level")) >= level) {
                item.destroy();
                i--;
            }
        }
        document.body.insertAdjacentElement("beforeend", this.element);

        if (this.targetElement) {
            this.targetElement.style.cursor = "wait";
        }

        this.element.setAttribute("data-pin", "false");
        this.element.addEventListener("dblclick", (event) => {
            const target = event.target as HTMLElement;
            const iconsElement = hasClosestByClassName(target, "block__icons");
            if (iconsElement) {
                const pingElement = iconsElement.querySelector('[data-type="pin"]');
                if (this.element.getAttribute("data-pin") === "true") {
                    pingElement.setAttribute("aria-label", window.siyuan.languages.pin);
                    pingElement.querySelector("use").setAttribute("xlink:href", "#iconPin");
                    this.element.setAttribute("data-pin", "false");
                } else {
                    pingElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                    pingElement.querySelector("use").setAttribute("xlink:href", "#iconUnpin");
                    this.element.setAttribute("data-pin", "true");
                }
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.element.addEventListener("click", (event) => {
            if (this.element && window.siyuan.blockPanels.length > 1) {
                this.element.style.zIndex = (++window.siyuan.zIndex).toString();
            }

            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon") || target.classList.contains("block__logo")) {
                    const type = target.getAttribute("data-type");
                    if (type === "close") {
                        this.destroy();
                    } else if (type === "pin") {
                        if (this.element.getAttribute("data-pin") === "true") {
                            target.setAttribute("aria-label", window.siyuan.languages.pin);
                            target.querySelector("use").setAttribute("xlink:href", "#iconPin");
                            this.element.setAttribute("data-pin", "false");
                        } else {
                            target.setAttribute("aria-label", window.siyuan.languages.unpin);
                            target.querySelector("use").setAttribute("xlink:href", "#iconUnpin");
                            this.element.setAttribute("data-pin", "true");
                        }
                    } else if (type === "open") {
                        /// #if !BROWSER
                        openNewWindowById(this.refDefs[0].refID);
                        /// #endif
                    } else if (type === "stickTab") {
                        checkFold(this.refDefs[0].refID, (zoomIn, action) => {
                            openFileById({
                                app: options.app,
                                id: this.refDefs[0].refID,
                                action,
                                zoomIn,
                                openNewTab: true
                            });
                        });
                        this.destroy();
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        /// #if !MOBILE
        moveResize(this.element, (type) => {
            // 拖拽时移除嵌入块模式
            if (this.element.classList.contains("block__popover--embed")) {
                // 保存当前位置和尺寸
                const currentRect = this.element.getBoundingClientRect();
                
                // 🔑 动态计算工具栏高度，更准确
                let toolbarHeight = 42; // 默认高度
                const existingToolbar = this.element.querySelector(".block__icons");
                if (existingToolbar) {
                    const toolbarRect = existingToolbar.getBoundingClientRect();
                    if (toolbarRect.height > 0) {
                        toolbarHeight = toolbarRect.height;
                    }
                }
                
                // 🔑 先清理嵌入块模式，再移除样式类
                this.cleanupEmbedMode();
                this.element.classList.remove("block__popover--embed");
                
                // 🔑 计算最佳位置，确保工具栏可见且不超出屏幕
                const newTop = Math.max(currentRect.top - toolbarHeight, 10);
                const newLeft = Math.max(currentRect.left, 10);
                const newWidth = Math.max(currentRect.width, 400); // 确保最小宽度
                const newHeight = currentRect.height + toolbarHeight;
                
                // 🔑 设置转换后的位置和尺寸
                this.element.style.left = newLeft + "px";
                this.element.style.top = newTop + "px";
                this.element.style.width = newWidth + "px";
                this.element.style.height = newHeight + "px";
                
                // 🔑 设置普通浮窗的约束
                this.element.style.maxWidth = Math.max(newWidth, 1024) + "px";
                this.element.style.minWidth = "300px";
                this.element.style.minHeight = "200px";
                
                // 🔑 确保浮窗可见性和层级
                this.element.style.display = "";
                this.element.style.zIndex = (++window.siyuan.zIndex).toString();
                
                // 🔑 触发resize事件，确保内容重新布局
                setTimeout(() => {
                    this.editors.forEach(editor => {
                        if (editor && editor.protyle) {
                            resize(editor.protyle);
                        }
                    });
                }, 50);
            }
            
            const pinElement = this.element.firstElementChild.querySelector('[data-type="pin"]');
            if (pinElement) {
                pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                const useElement = pinElement.querySelector("use");
                if (useElement) {
                    useElement.setAttribute("xlink:href", "#iconUnpin");
                }
            }
            this.element.setAttribute("data-pin", "true");
        });
        /// #endif

        // 检测并设置嵌入块模式
        if (this.targetElement && this.targetElement.classList.contains("protyle-wysiwyg__embed")) {
            this.element.classList.add("block__popover--embed");
            this.initEmbedMode();
        }

        this.render();
    }

    private initProtyle(editorElement: HTMLElement, afterCB?: () => void) {
        const index = parseInt(editorElement.getAttribute("data-index"));
        fetchPost("/api/block/getBlockInfo", {id: this.refDefs[index].refID}, (response) => {
            if (response.code === 3) {
                showMessage(response.msg);
                return;
            }
            if (!this.targetElement && typeof this.x === "undefined" && typeof this.y === "undefined") {
                return;
            }
            const action: TProtyleAction[] = [];
            if (response.data.rootID !== this.refDefs[index].refID) {
                action.push(Constants.CB_GET_ALL);
            } else {
                action.push(Constants.CB_GET_CONTEXT);
                // 不需要高亮 https://github.com/siyuan-note/siyuan/issues/11160#issuecomment-2084652764
            }

            if (this.isBacklink) {
                action.push(Constants.CB_GET_BACKLINK);
            }
            const editor = new Protyle(this.app, editorElement, {
                blockId: this.refDefs[index].refID,
                defIds: this.refDefs[index].defIDs || [],
                originalRefBlockIDs: this.isBacklink ? this.originalRefBlockIDs : undefined,
                action,
                render: {
                    scroll: true,
                    gutter: true,
                    breadcrumbDocName: true,
                },
                typewriterMode: false,
                after: (editor) => {
                    if (response.data.rootID !== this.refDefs[index].refID) {
                        editor.protyle.breadcrumb.element.parentElement.lastElementChild.classList.remove("fn__none");
                    }
                    if (afterCB) {
                        afterCB();
                    }
                    // https://ld246.com/article/1653639418266
                    if (editor.protyle.element.nextElementSibling || editor.protyle.element.previousElementSibling) {
                        editor.protyle.element.style.minHeight = Math.min(30 + editor.protyle.wysiwyg.element.clientHeight, window.innerHeight / 3) + "px";
                    }
                    // 由于 afterCB 中高度的设定，需在之后再进行设定
                    // 49 = 16（上图标）+16（下图标）+8（padding）+9（底部距离）
                    editor.protyle.scroll.element.parentElement.setAttribute("style", `--b3-dynamicscroll-width:${Math.min(editor.protyle.contentElement.clientHeight - 49, 200)}px;`);
                }
            });
            this.editors.push(editor);
        });
    }

    private initEmbedMode() {
        // 设置初始样式和位置
        this.updateEmbedPosition();
        
        // 检查嵌入块面包屑设置
        this.checkEmbedBreadcrumb();
        
        // 监听滚动事件
        const contentElement = hasClosestByClassName(this.targetElement, "protyle-content", true);
        if (contentElement) {
            // 🔑 移除被动监听器，确保实时响应
            contentElement.addEventListener("scroll", this.scrollHandler);
        }
        
        // 监听窗口大小变化
        window.addEventListener("resize", this.resizeHandler);
    }

    private updateEmbedPosition() {
        if (!this.targetElement || !document.body.contains(this.targetElement)) {
            return;
        }
        
        // 获取嵌入块容器（NodeBlockQueryEmbed）的位置，这是实际需要覆盖的元素
        const embedContainer = this.targetElement.closest('[data-type="NodeBlockQueryEmbed"]') as HTMLElement;
        if (!embedContainer) {
            return;
        }
        
        const targetRect = embedContainer.getBoundingClientRect();
        const contentElement = hasClosestByClassName(this.targetElement, "protyle-content", true);
        
        // 检查是否完全不可见
        if (contentElement) {
            const contentRect = contentElement.getBoundingClientRect();
            if (targetRect.bottom < contentRect.top || targetRect.top > contentRect.bottom) {
                this.element.style.display = "none";
                return;
            }
        }
        
        this.element.style.display = "";
        
        // 🔑 计算裁剪状态和偏移量
        let clipTop = 0;
        let clipBottom = 0;
        let isTopClipped = false;
        let isBottomClipped = false;
        
        if (contentElement) {
            const contentRect = contentElement.getBoundingClientRect();
            
            if (targetRect.top < contentRect.top) {
                clipTop = contentRect.top - targetRect.top;
                isTopClipped = true;
            }
            
            if (targetRect.bottom > contentRect.bottom) {
                clipBottom = targetRect.bottom - contentRect.bottom;
                isBottomClipped = true;
            }
        }
        
        // 🔑 应用动态边框样式类
        this.element.classList.remove(
            "block__popover--embed-clipped-top",
            "block__popover--embed-clipped-bottom", 
            "block__popover--embed-clipped-both"
        );
        
        if (isTopClipped && isBottomClipped) {
            this.element.classList.add("block__popover--embed-clipped-both");
        } else if (isTopClipped) {
            this.element.classList.add("block__popover--embed-clipped-top");
        } else if (isBottomClipped) {
            this.element.classList.add("block__popover--embed-clipped-bottom");
        }
        
        // 🔑 新策略：始终根据嵌入块设置显示面包屑，不因裁剪而隐藏
        // 这样可以保持内容的相对位置关系，面包屑会被自然裁剪
        this.checkEmbedBreadcrumb();
        
        // 计算浮窗的实际显示区域（保持原始高度比例）
        const visibleTop = Math.max(targetRect.top, contentElement ? contentElement.getBoundingClientRect().top : targetRect.top);
        const visibleBottom = Math.min(targetRect.bottom, contentElement ? contentElement.getBoundingClientRect().bottom : targetRect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        
        // 设置浮窗位置和尺寸
        this.element.style.left = targetRect.left + "px";
        this.element.style.top = visibleTop + "px";
        this.element.style.width = targetRect.width + "px";
        this.element.style.height = visibleHeight + "px";
        this.element.style.maxWidth = "none";
        this.element.style.minWidth = "none";
        
        // 🔑 强制设置宽度，确保覆盖所有CSS设置
        this.element.style.setProperty("width", targetRect.width + "px", "important");
        
        // 🔑 关键：实现内容同步滚动，保持简单的偏移
        this.syncEmbedContent(clipTop);
    }

    // 🔑 新增：更新面包屑可见性
    private updateBreadcrumbVisibility(showBreadcrumb: boolean) {
        if (!showBreadcrumb) {
            // 顶部被裁剪时隐藏面包屑
            const breadcrumbContainers = this.element.querySelectorAll(".protyle-breadcrumb");
            breadcrumbContainers.forEach((container: HTMLElement) => {
                container.style.display = "none";
            });
        } else {
            // 根据嵌入块设置决定是否显示面包屑
            this.checkEmbedBreadcrumb();
        }
    }

    // 🔑 新增：同步嵌入块内容滚动
    private syncEmbedContent(scrollOffset: number) {
        if (!this.editors || this.editors.length === 0) {
            return;
        }

        // 对所有编辑器应用滚动偏移
        this.editors.forEach(editor => {
            try {
                const wysiwygElement = editor.protyle.wysiwyg.element;
                if (wysiwygElement) {
                    // 🔑 优化：使用transform替代margin，提供更精确的像素级定位
                    if (scrollOffset > 0) {
                        wysiwygElement.style.transform = `translateY(-${scrollOffset}px)`;
                        wysiwygElement.style.marginTop = "";  // 清除可能的margin设置
                    } else {
                        wysiwygElement.style.transform = "";
                        wysiwygElement.style.marginTop = "";
                    }
                }
                
                // 如果有面包屑，也需要同步偏移
                const breadcrumbElement = this.element.querySelector(".protyle-breadcrumb");
                if (breadcrumbElement) {
                    if (scrollOffset > 0) {
                        (breadcrumbElement as HTMLElement).style.transform = `translateY(-${scrollOffset}px)`;
                        (breadcrumbElement as HTMLElement).style.marginTop = "";
                    } else {
                        (breadcrumbElement as HTMLElement).style.transform = "";
                        (breadcrumbElement as HTMLElement).style.marginTop = "";
                    }
                }
            } catch (error) {
                console.warn("同步嵌入块内容失败:", error);
            }
        });
    }

    private checkEmbedBreadcrumb() {
        if (!this.targetElement) return;
        
        // 从targetElement向上查找嵌入块容器
        let embedBlockElement = this.targetElement;
        while (embedBlockElement && embedBlockElement !== document.body) {
            if (embedBlockElement.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                break;
            }
            embedBlockElement = embedBlockElement.parentElement;
        }
        
        if (!embedBlockElement || embedBlockElement.getAttribute("data-type") !== "NodeBlockQueryEmbed") {
            // 使用全局设置作为默认值
            this.toggleBreadcrumb(window.siyuan.config.editor.embedBlockBreadcrumb);
            return;
        }
        
        // 检查面包屑设置
        let showBreadcrumb: boolean | string = embedBlockElement.getAttribute("breadcrumb");
        if (showBreadcrumb !== null) {
            showBreadcrumb = showBreadcrumb === "true";
        } else {
            showBreadcrumb = window.siyuan.config.editor.embedBlockBreadcrumb;
        }
        
        this.toggleBreadcrumb(showBreadcrumb);
    }

    private toggleBreadcrumb(show: boolean) {
        // 根据设置动态显示/隐藏整个面包屑容器
        setTimeout(() => {
            // 控制整个面包屑容器，而不仅仅是面包屑栏
            const breadcrumbContainers = this.element.querySelectorAll(".protyle-breadcrumb");
            breadcrumbContainers.forEach((container: HTMLElement) => {
                container.style.display = show ? "" : "none";
            });
            
            // 同时也控制单独的面包屑栏（兼容不同的HTML结构）
            const breadcrumbBars = this.element.querySelectorAll(".protyle-breadcrumb__bar");
            breadcrumbBars.forEach((bar: HTMLElement) => {
                bar.style.display = show ? "" : "none";
            });
        }, 100); // 延迟执行，确保内容已渲染
    }

    private cleanupEmbedMode() {
        // 移除事件监听
        const contentElement = hasClosestByClassName(this.targetElement, "protyle-content", true);
        if (contentElement) {
            contentElement.removeEventListener("scroll", this.scrollHandler);
        }
        window.removeEventListener("resize", this.resizeHandler);
        
        // 🔧 重置浮窗样式
        this.element.style.display = "";
        
        // 🔑 移除所有嵌入块相关的强制样式
        this.element.style.removeProperty("width");
        this.element.style.removeProperty("left");
        this.element.style.removeProperty("top");
        this.element.style.removeProperty("height");
        this.element.style.removeProperty("max-width");
        this.element.style.removeProperty("min-width");
        
        // 🔑 移除动态边框样式类
        this.element.classList.remove(
            "block__popover--embed-clipped-top",
            "block__popover--embed-clipped-bottom", 
            "block__popover--embed-clipped-both"
        );
        
        // 🔑 重置内容偏移和样式
        this.editors.forEach(editor => {
            try {
                const wysiwygElement = editor.protyle.wysiwyg.element;
                if (wysiwygElement) {
                    wysiwygElement.style.marginTop = "";
                    wysiwygElement.style.transform = "";
                    // 🔑 清除可能的强制样式属性
                    wysiwygElement.style.removeProperty("padding");
                }
                
                // 🔑 重置protyle容器样式
                const protyleElement = editor.protyle.element;
                if (protyleElement) {
                    protyleElement.style.removeProperty("min-height");
                }
                
                // 🔑 重置protyle内容区域
                const protyleContent = editor.protyle.contentElement;
                if (protyleContent) {
                    protyleContent.style.removeProperty("padding");
                    protyleContent.style.removeProperty("margin");
                    protyleContent.style.removeProperty("overflow");
                }
            } catch (error) {
                console.warn("重置内容偏移失败:", error);
            }
        });
        
        // 重置面包屑偏移和样式
        const breadcrumbElements = this.element.querySelectorAll(".protyle-breadcrumb");
        breadcrumbElements.forEach((breadcrumbElement: HTMLElement) => {
            breadcrumbElement.style.marginTop = "";
            breadcrumbElement.style.transform = "";
            breadcrumbElement.style.removeProperty("padding");
            breadcrumbElement.style.display = ""; // 恢复显示
        });
        
        // 重置面包屑栏
        const breadcrumbBars = this.element.querySelectorAll(".protyle-breadcrumb__bar");
        breadcrumbBars.forEach((bar: HTMLElement) => {
            bar.style.display = "";
        });
        
        // 🔑 重置block__content样式
        const blockContent = this.element.querySelector(".block__content");
        if (blockContent) {
            (blockContent as HTMLElement).style.removeProperty("padding");
            (blockContent as HTMLElement).style.removeProperty("margin");
            (blockContent as HTMLElement).style.removeProperty("overflow");
        }
        
        // 🔑 确保工具栏显示
        const blockIcons = this.element.querySelector(".block__icons");
        if (blockIcons) {
            (blockIcons as HTMLElement).style.display = "";
        }
        
        // 🔑 恢复普通浮窗的默认约束（如果不是通过拖拽切换的话）
        if (!this.element.style.width) {
            // 只有在没有明确设置宽度时才应用默认样式
            this.element.style.width = "60vw";
            this.element.style.maxWidth = "1024px";
            this.element.style.minWidth = "";
            this.element.style.height = "";
            this.element.style.left = "";
            this.element.style.top = "";
        }
    }

    // 🔑 设置光标位置
    private setCursorPosition(protyle: Protyle) {
        if (!this.clickInfo || !this.element.classList.contains("block__popover--embed")) {
            return;
        }

        try {
            // 获取浮窗内的编辑器元素
            const wysiwygElement = protyle.protyle.wysiwyg.element;
            if (!wysiwygElement) {
                return;
            }

            // 计算相对于浮窗编辑器的位置
            const editorRect = wysiwygElement.getBoundingClientRect();
            const relativeX = this.clickInfo.clientX - editorRect.left;
            const relativeY = this.clickInfo.clientY - editorRect.top;

            // 使用document.caretRangeFromPoint获取光标位置
            const absoluteX = editorRect.left + relativeX;
            const absoluteY = editorRect.top + relativeY;

            // 确保坐标在编辑器范围内
            if (relativeX >= 0 && relativeX <= editorRect.width && 
                relativeY >= 0 && relativeY <= editorRect.height) {
                
                const range = getRangeByPoint(absoluteX, absoluteY);
                if (range && wysiwygElement.contains(range.startContainer)) {
                    // 设置光标位置
                    focusByRange(range);
                    protyle.protyle.toolbar.range = range;
                }
            }
        } catch (error) {
            console.warn("设置光标位置失败:", error);
        }
    }

    public destroy() {
        // 清理嵌入块模式
        if (this.element && this.element.classList.contains("block__popover--embed")) {
            this.cleanupEmbedMode();
        }
        
        this.observerResize?.disconnect();
        this.observerLoad?.disconnect();
        window.siyuan.blockPanels.find((item, index) => {
            if (item.id === this.id) {
                window.siyuan.blockPanels.splice(index, 1);
                return true;
            }
        });
        if (this.editors.length > 0) {
            this.editors.forEach(item => {
                // https://github.com/siyuan-note/siyuan/issues/8199
                hideElements(["util"], item.protyle);
                item.destroy();
            });
            this.editors = [];
        }
        const level = parseInt(this.element.dataset.level);
        this.element.remove();
        this.element = undefined;
        this.targetElement = undefined;
        // 移除弹出上使用右键菜单
        const menuLevel = parseInt(window.siyuan.menus.menu.element.dataset.from);
        if (window.siyuan.menus.menu.element.dataset.from !== "app" && menuLevel && menuLevel >= level) {
            // https://github.com/siyuan-note/siyuan/issues/9854 右键菜单不是从浮窗中弹出的则不进行移除
            window.siyuan.menus.menu.remove();
        }
    }

    private render() {
        if (!document.body.contains(this.element)) {
            this.destroy();
            return;
        }
        let openHTML = "";
        if (this.refDefs.length === 1) {
            openHTML = `<span data-type="stickTab" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.openInNewTab}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.openInNewTab.custom)}"><svg><use xlink:href="#iconOpen"></use></svg></span>
<span class="fn__space"></span>`;
            /// #if !BROWSER
            openHTML += `<span data-type="open" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.openByNewWindow}"><svg><use xlink:href="#iconOpenWindow"></use></svg></span>
<span class="fn__space"></span>`;
            /// #endif
        }
        let html = `<div class="block__icons block__icons--menu">
    <span class="fn__space fn__flex-1 resize__move"></span>${openHTML}
    <span data-type="pin" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.pin}"><svg><use xlink:href="#iconPin"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="close" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.close}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg style="width: 12px;margin: 0 1px;"><use xlink:href="#iconClose"></use></svg></span>
</div>
<div class="block__content">`;
        if (this.refDefs.length === 0) {
            html += `<div class="ft__smaller ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>`;
        } else {
            this.refDefs.forEach((item, index) => {
                html += `<div class="block__edit fn__flex-1 protyle" data-index="${index}"></div>`;
            });
        }
        if (html) {
            html += '</div><div class="resize__rd"></div><div class="resize__ld"></div><div class="resize__lt"></div><div class="resize__rt"></div><div class="resize__r"></div><div class="resize__d"></div><div class="resize__t"></div><div class="resize__l"></div>';
        }
        this.element.innerHTML = html;
        let resizeTimeout: number;
        this.observerResize = new ResizeObserver(() => {
            clearTimeout(resizeTimeout);
            resizeTimeout = window.setTimeout(() => {
                this.editors.forEach(item => {
                    resize(item.protyle);
                });
            }, Constants.TIMEOUT_TRANSITION);
        });
        this.observerResize.observe(this.element);
        this.observerLoad = new IntersectionObserver((e) => {
            e.forEach(item => {
                if (item.isIntersecting && item.target.innerHTML === "") {
                    this.initProtyle(item.target as HTMLElement);
                }
            });
        }, {
            threshold: 0,
        });
        this.element.querySelectorAll(".block__edit").forEach((item: HTMLElement, index) => {
            if (index < 5) {
                this.initProtyle(item, index === 0 ? () => {
                    if (!document.contains(this.element)) {
                        return;
                    }
                    let targetRect;
                    if (this.targetElement && this.targetElement.classList.contains("protyle-wysiwyg__embed")) {
                        // 嵌入块模式下的特殊处理
                        if (this.element.classList.contains("block__popover--embed")) {
                            // 无感编辑模式：使用updateEmbedPosition来精确定位，不在这里设置高度
                            this.updateEmbedPosition();
                            
                            // 🔑 设置光标位置（延迟执行，确保DOM已完全渲染）
                            setTimeout(() => {
                                if (this.editors.length > 0) {
                                    this.setCursorPosition(this.editors[0]);
                                }
                            }, 100);
                        } else {
                            // 传统嵌入块浮窗模式
                            targetRect = this.targetElement.getBoundingClientRect();
                            // 嵌入块过长时，单击弹出的悬浮窗位置居下 https://ld246.com/article/1634292738717
                            let top = targetRect.top;
                            const contentElement = hasClosestByClassName(this.targetElement, "protyle-content", true);
                            if (contentElement) {
                                const contentRectTop = contentElement.getBoundingClientRect().top;
                                if (targetRect.top < contentRectTop) {
                                    top = contentRectTop;
                                }
                            }
                            // 单击嵌入块悬浮窗的位置最好是覆盖嵌入块
                            // 防止图片撑高后悬浮窗显示不下，只能设置高度
                            this.element.style.height = Math.min(window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT, targetRect.height + 42) + "px";
                            setPosition(this.element, targetRect.left, Math.max(top - 42, Constants.SIZE_TOOLBAR_HEIGHT), -42, 0);
                        }
                    } else if (this.targetElement) {
                        if (this.targetElement.classList.contains("pdf__rect")) {
                            targetRect = this.targetElement.firstElementChild.getBoundingClientRect();
                        } else {
                            targetRect = this.targetElement.getBoundingClientRect();
                        }
                        // 下部位置大的话就置于下部 https://ld246.com/article/1690333302147
                        if (window.innerHeight - targetRect.bottom - 4 > targetRect.top + 12) {
                            this.element.style.maxHeight = Math.floor(window.innerHeight - targetRect.bottom - 12) + "px";
                        }
                        // 靠边不宜拖拽 https://github.com/siyuan-note/siyuan/issues/2937
                        setPosition(this.element, targetRect.left, targetRect.bottom + 4, targetRect.height + 12, 8);
                    } else if (typeof this.x === "number" && typeof this.y === "number") {
                        setPosition(this.element, this.x, this.y);
                        this.element.style.maxHeight = Math.floor(window.innerHeight - Math.max(this.y, Constants.SIZE_TOOLBAR_HEIGHT) - 12) + "px";
                    }
                    const elementRect = this.element.getBoundingClientRect();
                    if (this.targetElement && !this.targetElement.classList.contains("protyle-wysiwyg__embed")) {
                        if (elementRect.top < targetRect.top) {
                            this.element.style.maxHeight = Math.floor(targetRect.top - elementRect.top - 8) + "px";
                        } else {
                            this.element.style.maxHeight = Math.floor(window.innerHeight - elementRect.top - 8) + "px";
                        }
                    }
                    this.element.classList.add("block__popover--open");
                    this.element.style.zIndex = (++window.siyuan.zIndex).toString();
                } : undefined);
            } else {
                this.observerLoad.observe(item);
            }
        });
        if (this.targetElement) {
            this.targetElement.style.cursor = "";
        }

        this.element.querySelector(".block__content").addEventListener("scroll", () => {
            this.editors.forEach(item => {
                hideElements(["gutter"], item.protyle);
            });
        });
    }
}
