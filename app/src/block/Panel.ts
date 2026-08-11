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
import type {App} from "../index";
import {resize} from "../protyle/util/resize";
import {checkFold} from "../util/noRelyPCFunction";
import {updateHotkeyAfterTip} from "../protyle/util/compatibility";
import {getTopBarHeight} from "../layout/getTopBarHeight";
import {activateAVLocateWithRetry} from "../protyle/render/av/locate";
import {
    IBlockPanelItemInfo,
    IBlockPanelRemovalOptions,
    matchesBlockPanelRemoval,
    planBlockPanelRemoval
} from "./panelRemoval";
import {getBlockPanelLoadPlan} from "./panelLoad";

const BLOCK_PANEL_EDITOR_MIN_HEIGHT = 155;

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
    private editorResizeCleanup?: () => void;
    private refDefElements = new Map<IRefDefs, HTMLElement>();
    private refDefEditors = new Map<IRefDefs, Protyle>();
    private refDefInfos = new Map<IRefDefs, IBlockPanelItemInfo>();
    private destroying = false;

    // x,y 和 targetElement 二选一必传
    constructor(options: {
        app: App,
        targetElement?: HTMLElement,
        refDefs: IRefDefs[]
        isBacklink: boolean,
        originalRefBlockIDs?: IObject,  // isBacklink 为 true 时有效
        x?: number,
        y?: number,
    }) {
        this.id = genUUID();
        this.targetElement = options.targetElement;
        this.refDefs = options.refDefs;
        this.app = options.app;
        this.x = options.x;
        this.y = options.y;
        this.isBacklink = options.isBacklink;
        this.originalRefBlockIDs = options.originalRefBlockIDs;

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
                                openNewTab: true,
                                scrollPosition: "start"
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
        moveResize(this.element, () => {
            this.pin();
        });
        /// #endif
        this.render();
    }

    private pin() {
        const pinElement = this.element?.firstElementChild?.querySelector('[data-type="pin"]');
        if (!pinElement) {
            return;
        }
        pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
        pinElement.querySelector("use").setAttribute("xlink:href", "#iconUnpin");
        this.element.setAttribute("data-pin", "true");
    }

    private setAutoEditorHeight(editor: Protyle) {
        const editorElement = editor.protyle.element;
        editorElement.style.flex = "";
        editorElement.style.height = "";
        delete editorElement.dataset.resized;
        editorElement.style.minHeight = this.refDefs.length > 1 ?
            Math.min(30 + editor.protyle.wysiwyg.element.clientHeight, window.innerHeight / 3) + "px" : "";
    }

    private resizeEditor(editor: Protyle) {
        resize(editor.protyle);
        editor.protyle.scroll.element.parentElement.style.setProperty(
            "--b3-dynamicscroll-width",
            Math.min(editor.protyle.contentElement.clientHeight - 49, 200) + "px"
        );
    }

    private getEditor(editorElement: HTMLElement) {
        return this.editors.find(item => item.protyle.element === editorElement);
    }

    private updateEditorIndexes() {
        this.refDefs.forEach((refDef, index) => {
            this.refDefElements.get(refDef)?.setAttribute("data-index", index.toString());
        });
    }

    private removeRefDef(refDef: IRefDefs) {
        if (!this.element || !this.refDefs.includes(refDef)) {
            return;
        }
        this.editorResizeCleanup?.();
        const editor = this.refDefEditors.get(refDef);
        if (editor) {
            this.refDefEditors.delete(refDef);
            const editorIndex = this.editors.indexOf(editor);
            if (editorIndex > -1) {
                this.editors.splice(editorIndex, 1);
            }
            hideElements(["util"], editor.protyle);
            editor.destroy();
        }
        const editorElement = this.refDefElements.get(refDef);
        if (editorElement) {
            this.observerLoad?.unobserve(editorElement);
        }
        if (editorElement?.nextElementSibling?.classList.contains("block__edit-resize")) {
            editorElement.nextElementSibling.remove();
        }
        editorElement?.remove();
        this.refDefElements.delete(refDef);
        this.refDefInfos.delete(refDef);
        this.refDefs.splice(this.refDefs.indexOf(refDef), 1);
        if (this.refDefs.length === 0) {
            this.destroy();
            return;
        }
        this.updateEditorIndexes();
        if (this.refDefs.length === 1) {
            this.element.querySelectorAll(".block__edit-resize").forEach(item => item.remove());
            const remainingEditor = this.refDefEditors.get(this.refDefs[0]);
            if (remainingEditor) {
                this.setAutoEditorHeight(remainingEditor);
                this.resizeEditor(remainingEditor);
            }
        }
    }

    private resolveRemoval(refDef: IRefDefs, options: IBlockPanelRemovalOptions) {
        if (!this.element || !this.refDefs.includes(refDef)) {
            return;
        }
        fetchPost("/api/block/getBlockInfo", {id: refDef.refID}, (response) => {
            if (!this.element || !this.refDefs.includes(refDef)) {
                return;
            }
            if (response.code === 3) {
                return;
            }
            if (response.code !== 0) {
                this.removeRefDef(refDef);
                return;
            }
            const info = {
                notebookId: response.data.box,
                rootID: response.data.rootID,
            };
            this.refDefInfos.set(refDef, info);
            if (matchesBlockPanelRemoval(info, options)) {
                this.removeRefDef(refDef);
            }
        });
    }

    public removeEditors(options: IBlockPanelRemovalOptions) {
        if (!this.element) {
            return;
        }
        const removalPlan = planBlockPanelRemoval(this.refDefs, (refDef) => {
            const editor = this.refDefEditors.get(refDef);
            const cachedInfo = this.refDefInfos.get(refDef);
            return editor ? {
                notebookId: editor.protyle.notebookId || cachedInfo?.notebookId,
                rootID: editor.protyle.block.rootID || cachedInfo?.rootID,
            } : cachedInfo;
        }, options);
        removalPlan.removeItems.forEach(refDef => this.removeRefDef(refDef));
        if (this.element) {
            removalPlan.unresolvedItems.forEach(refDef => this.resolveRemoval(refDef, options));
        }
    }

    private bindEditorResize() {
        const contentElement = this.element.querySelector(".block__content") as HTMLElement;
        contentElement.querySelectorAll(".block__edit-resize").forEach((resizeElement: HTMLElement) => {
            resizeElement.addEventListener("mousedown", (event: MouseEvent) => {
                const editorElement = resizeElement.previousElementSibling as HTMLElement;
                if (!editorElement?.classList.contains("block__edit")) {
                    return;
                }
                this.editorResizeCleanup?.();
                const documentSelf = document;
                const startY = event.clientY;
                const startHeight = editorElement.getBoundingClientRect().height;
                const panelHeight = this.element.getBoundingClientRect().height;
                const minHeight = Math.min(startHeight, BLOCK_PANEL_EDITOR_MIN_HEIGHT);
                const maxHeight = Math.max(startHeight, contentElement.clientHeight);
                let hasMove = false;
                let resizeFrame: number;
                const scheduleResize = () => {
                    cancelAnimationFrame(resizeFrame);
                    resizeFrame = requestAnimationFrame(() => {
                        const editor = this.getEditor(editorElement);
                        if (editor) {
                            this.resizeEditor(editor);
                        }
                    });
                };
                const cleanup = () => {
                    cancelAnimationFrame(resizeFrame);
                    resizeElement.classList.remove("block__edit-resize--active");
                    if (this.element) {
                        this.element.style.userSelect = "";
                    }
                    documentSelf.onmousemove = null;
                    documentSelf.onmouseup = null;
                    documentSelf.ondragstart = null;
                    documentSelf.onselectstart = null;
                    documentSelf.onselect = null;
                    if (this.editorResizeCleanup === cleanup) {
                        this.editorResizeCleanup = undefined;
                    }
                };
                this.editorResizeCleanup = cleanup;
                this.element.style.userSelect = "none";
                resizeElement.classList.add("block__edit-resize--active");
                documentSelf.ondragstart = () => false;
                documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    const height = Math.max(minHeight, Math.min(maxHeight, startHeight + moveEvent.clientY - startY));
                    if (height === startHeight && !hasMove) {
                        return;
                    }
                    if (!hasMove) {
                        this.element.style.height = panelHeight + "px";
                        this.element.style.maxHeight = "";
                        this.pin();
                        hasMove = true;
                    }
                    const roundedHeight = Math.round(height);
                    editorElement.dataset.resized = "true";
                    editorElement.style.flex = `0 0 ${roundedHeight}px`;
                    editorElement.style.height = roundedHeight + "px";
                    editorElement.style.minHeight = roundedHeight + "px";
                    scheduleResize();
                };
                documentSelf.onmouseup = () => {
                    cleanup();
                    if (hasMove) {
                        const editor = this.getEditor(editorElement);
                        if (editor) {
                            this.resizeEditor(editor);
                        }
                    }
                };
                event.preventDefault();
                event.stopPropagation();
            });
            resizeElement.addEventListener("dblclick", (event: MouseEvent) => {
                const editorElement = resizeElement.previousElementSibling as HTMLElement;
                if (!editorElement?.classList.contains("block__edit")) {
                    return;
                }
                editorElement.style.flex = "";
                editorElement.style.height = "";
                editorElement.style.minHeight = "";
                delete editorElement.dataset.resized;
                const editor = this.getEditor(editorElement);
                if (editor) {
                    this.setAutoEditorHeight(editor);
                    this.resizeEditor(editor);
                }
                event.preventDefault();
                event.stopPropagation();
            });
        });
    }

    private initProtyle(editorElement: HTMLElement, afterCB?: () => void) {
        if (!editorElement.isConnected) {
            return;
        }
        const refDef = this.refDefs[parseInt(editorElement.getAttribute("data-index"))];
        if (!refDef) {
            return;
        }
        fetchPost("/api/block/getBlockInfo", {id: refDef.refID}, (response) => {
            if (!this.element || !this.refDefs.includes(refDef) || !editorElement.isConnected) {
                return;
            }
            if (response.code === 3) {
                showMessage(response.msg);
                return;
            }
            if (response.code !== 0) {
                this.removeRefDef(refDef);
                return;
            }
            this.refDefInfos.set(refDef, {
                notebookId: response.data.box,
                rootID: response.data.rootID,
            });
            const loadPlan = getBlockPanelLoadPlan(response.data.rootID, refDef.refID, this.isBacklink);
            const action: TProtyleAction[] = [];
            if (!loadPlan.isDocument) {
                action.push(Constants.CB_GET_ALL);
            } else {
                action.push(Constants.CB_GET_CONTEXT);
                // 不需要高亮 https://github.com/siyuan-note/siyuan/issues/11160#issuecomment-2084652764
            }

            if (loadPlan.useBacklinkContext) {
                action.push(Constants.CB_GET_BACKLINK);
            }
            let isInitialRender = true;
            const editor = new Protyle(this.app, editorElement, {
                databaseAttr: true,
                blockId: refDef.refID,
                defIds: refDef.defIDs || [],
                originalRefBlockIDs: loadPlan.useBacklinkContext ? this.originalRefBlockIDs : undefined,
                action,
                render: {
                    scroll: true,
                    gutter: true,
                    breadcrumbDocName: true,
                    background: loadPlan.isDocument,
                    title: loadPlan.isDocument, // 如果块是文档，显示文档标题
                },
                typewriterMode: false,
                after: (editor) => {
                    if (!this.element || !this.refDefs.includes(refDef) || !editor.protyle.element.isConnected) {
                        return;
                    }
                    if (refDef.avItemID) {
                        activateAVLocateWithRetry(editor.protyle, refDef.refID, {
                            itemID: refDef.avItemID,
                            viewID: refDef.avViewID,
                            groupID: refDef.avGroupID,
                            select: false,
                            highlight: true,
                            persistView: false,
                        });
                    }
                    if (response.data.rootID !== refDef.refID) {
                        editor.protyle.breadcrumb.element.parentElement.lastElementChild.classList.remove("fn__none");
                    }
                    if (afterCB) {
                        afterCB();
                    }
                    if (isInitialRender) {
                        isInitialRender = false;
                        if (loadPlan.isDocument) {
                            const contentElement = editor.protyle.contentElement;
                            const titleElement = editor.protyle.title.element;
                            const marginTop = parseFloat(getComputedStyle(titleElement).marginTop) || 0;
                            const scrollTop = contentElement.scrollTop + titleElement.getBoundingClientRect().top -
                                contentElement.getBoundingClientRect().top - marginTop;
                            contentElement.scrollTop = scrollTop;
                            editor.protyle.scroll.lastScrollTop = contentElement.scrollTop;
                        }
                    }
                    // https://ld246.com/article/1653639418266
                    if (this.refDefs.length > 1 && editor.protyle.element.dataset.resized !== "true") {
                        this.setAutoEditorHeight(editor);
                    }
                    // 由于 afterCB 中高度的设定，需在之后再进行设定
                    // 49 = 16（上图标）+16（下图标）+8（padding）+9（底部距离）
                    editor.protyle.scroll.element.parentElement.setAttribute("style", `--b3-dynamicscroll-width:${Math.min(editor.protyle.contentElement.clientHeight - 49, 200)}px;`);
                }
            });
            this.refDefEditors.set(refDef, editor);
            this.editors.push(editor);
        });
    }

    public destroy() {
        if (!this.element || this.destroying) {
            return;
        }
        this.destroying = true;
        this.editorResizeCleanup?.();
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
        this.refDefElements.clear();
        this.refDefEditors.clear();
        this.refDefInfos.clear();
        const level = parseInt(this.element.dataset.level);
        this.element.remove();
        this.element = undefined;
        this.targetElement = undefined;
        // 移除弹出上使用右键菜单
        const menuLevel = parseInt(window.siyuan.menus.menu.element.dataset.from);
        if (menuLevel && menuLevel >= level && window.siyuan.menus.menu.element.dataset.from?.includes("popover")) {
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
    <span data-type="close" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.close}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href="#iconClose"></use></svg></span>
</div>
<div class="block__content">`;
        if (this.refDefs.length === 0) {
            html += `<div class="ft__smaller ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>`;
        } else {
            let editorResizeHTML = "";
            /// #if !MOBILE
            if (this.refDefs.length > 1) {
                editorResizeHTML = '<div class="block__edit-resize" role="separator" aria-orientation="horizontal"></div>';
            }
            /// #endif
            this.refDefs.forEach((item, index) => {
                html += `<div class="block__edit fn__flex-1 protyle" data-index="${index}"></div>`;
                html += editorResizeHTML;
            });
        }
        if (html) {
            html += '</div><div class="resize__rd"></div><div class="resize__ld"></div><div class="resize__lt"></div><div class="resize__rt"></div><div class="resize__r"></div><div class="resize__d"></div><div class="resize__t"></div><div class="resize__l"></div>';
        }
        this.element.innerHTML = html;
        /// #if !MOBILE
        this.bindEditorResize();
        /// #endif
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
        const topBarHeight = getTopBarHeight();
        this.element.querySelectorAll(".block__edit").forEach((item: HTMLElement, index) => {
            this.refDefElements.set(this.refDefs[index], item);
            if (index < 5) {
                this.initProtyle(item, index === 0 ? () => {
                    if (!document.contains(this.element)) {
                        return;
                    }
                    let targetRect;
                    if (this.targetElement && this.targetElement.classList.contains("protyle-wysiwyg__embed")) {
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
                        this.element.style.height = Math.min(window.innerHeight - topBarHeight, targetRect.height + 42) + "px";
                        setPosition(this.element, targetRect.left, Math.max(top - 42, topBarHeight), -42, 0);
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
                        this.element.style.maxHeight = Math.floor(window.innerHeight - Math.max(this.y, topBarHeight) - 12) + "px";
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
