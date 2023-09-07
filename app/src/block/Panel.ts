import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Protyle} from "../protyle";
import {genUUID} from "../util/genID";
import {setPadding} from "../protyle/ui/initUI";
import {setPosition} from "../util/setPosition";
import {hideElements} from "../protyle/ui/hideElements";
import {Constants} from "../constants";
/// #if !BROWSER
import {openNewWindowById} from "../window/openNewWindow";
/// #endif
/// #if !MOBILE
import {moveResize} from "../dialog/moveResize";
/// #endif
import {disabledProtyle} from "../protyle/util/onGet";
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";
import {App} from "../index";
import {isMobile} from "../util/functions";

export class BlockPanel {
    public element: HTMLElement;
    public targetElement: HTMLElement;
    public nodeIds: string[];
    public defIds: string[] = [];
    public id: string;
    private app: App;
    public x: number;
    public y: number;
    private isBacklink: boolean;
    public editors: Protyle[] = [];

    // x,y 和 targetElement 二选一必传
    constructor(options: {
        app: App,
        targetElement?: HTMLElement,
        nodeIds?: string[],
        defIds?: string[],
        isBacklink: boolean,
        x?: number,
        y?: number
    }) {
        this.id = genUUID();
        this.targetElement = options.targetElement;
        this.nodeIds = options.nodeIds;
        this.defIds = options.defIds || [];
        this.app = options.app;
        this.x = options.x;
        this.y = options.y;
        this.isBacklink = options.isBacklink;

        this.element = document.createElement("div");
        this.element.classList.add("block__popover");

        const parentElement = hasClosestByClassName(this.targetElement, "block__popover", true);
        let level = 1;
        if (parentElement) {
            this.element.setAttribute("data-oid", parentElement.getAttribute("data-oid"));
            level = parseInt(parentElement.getAttribute("data-level")) + 1;
        } else {
            this.element.setAttribute("data-oid", this.nodeIds[0]);
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
                if (pingElement.classList.contains("block__icon--active")) {
                    pingElement.classList.remove("block__icon--active");
                    pingElement.setAttribute("aria-label", window.siyuan.languages.pin);
                    this.element.setAttribute("data-pin", "false");
                } else {
                    pingElement.classList.add("block__icon--active");
                    pingElement.setAttribute("aria-label", window.siyuan.languages.unpin);
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
                        if (target.classList.contains("block__icon--active")) {
                            target.classList.remove("block__icon--active");
                            target.setAttribute("aria-label", window.siyuan.languages.pin);
                            this.element.setAttribute("data-pin", "false");
                        } else {
                            target.classList.add("block__icon--active");
                            target.setAttribute("aria-label", window.siyuan.languages.unpin);
                            this.element.setAttribute("data-pin", "true");
                        }
                    } else if (type === "open") {
                        /// #if !BROWSER
                        openNewWindowById(this.nodeIds[0]);
                        /// #endif
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
        });
        /// #if !MOBILE
        moveResize(this.element, (type: string) => {
            if (type !== "move") {
                this.editors.forEach(item => {
                    setPadding(item.protyle);
                });
            }
            const pinElement = this.element.firstElementChild.querySelector('[data-type="pin"]');
            pinElement.classList.add("block__icon--active");
            pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
            this.element.setAttribute("data-pin", "true");
        });
        /// #endif
        this.render();
    }

    private initProtyle(editorElement: HTMLElement, afterCB?: () => void) {
        const index = parseInt(editorElement.getAttribute("data-index"));
        fetchPost("/api/block/getBlockInfo", {id: this.nodeIds[index]}, (response) => {
            if (response.code === 3) {
                showMessage(response.msg);
                return;
            }
            if (!this.targetElement && typeof this.x === "undefined" && typeof this.y === "undefined") {
                return;
            }
            const action = [];
            if (response.data.rootID !== this.nodeIds[index]) {
                action.push(Constants.CB_GET_ALL);
            } else {
                action.push(Constants.CB_GET_SCROLL);
                action.push(Constants.CB_GET_HL);
            }

            if (this.isBacklink) {
                action.push(Constants.CB_GET_BACKLINK);
            }
            const editor = new Protyle(this.app, editorElement, {
                blockId: this.nodeIds[index],
                defId: this.defIds[index] || this.defIds[0] || "",
                action,
                render: {
                    scroll: true,
                    gutter: true,
                    breadcrumbDocName: true,
                },
                typewriterMode: false,
                after: (editor) => {
                    if (window.siyuan.config.readonly || window.siyuan.config.editor.readOnly) {
                        disabledProtyle(editor.protyle);
                    }
                    editorElement.addEventListener("mouseleave", () => {
                        hideElements(["gutter"], editor.protyle);
                    });
                    if (response.data.rootID !== this.nodeIds[index]) {
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
                    editor.protyle.scroll.element.parentElement.setAttribute("style", `--b3-dynamicscroll-width:${Math.min(editor.protyle.contentElement.clientHeight - 49, 200)}px;${isMobile() ? "" : "right:10px"}`);
                }
            });
            this.editors.push(editor);
        });
    }

    public destroy() {
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
        this.element.remove();
        this.element = undefined;
        this.targetElement = undefined;
        // 移除弹出上使用右键菜单
        window.siyuan.menus.menu.remove();
    }

    private render() {
        if (!document.body.contains(this.element)) {
            this.destroy();
            return;
        }
        let openHTML = "";
        /// #if !BROWSER
        if (this.nodeIds.length === 1) {
            openHTML = `<span data-type="open" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.openByNewWindow}"><svg><use xlink:href="#iconOpenWindow"></use></svg></span>
<span class="fn__space"></span>`;
        }
        /// #endif
        let html = `<div class="block__icons block__icons--menu">
    <span class="fn__space fn__flex-1 resize__move"></span>${openHTML}
    <span data-type="pin" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.pin}"><svg><use xlink:href="#iconPin"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="close" class="block__icon block__icon--show b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.close}"><svg style="width: 10px"><use xlink:href="#iconClose"></use></svg></span>
</div>
<div class="block__content">`;
        if (this.nodeIds.length === 0) {
            html += `<div class="ft__smaller ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>`;
        } else {
            this.nodeIds.forEach((item, index) => {
                html += `<div class="block__edit fn__flex-1 protyle" data-index="${index}"></div>`;
            });
        }
        if (html) {
            html += '</div><div class="resize__rd"></div><div class="resize__ld"></div><div class="resize__lt"></div><div class="resize__rt"></div><div class="resize__r"></div><div class="resize__d"></div><div class="resize__t"></div><div class="resize__l"></div>';
        }
        this.element.innerHTML = html;
        const observer = new IntersectionObserver((e) => {
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
                        this.element.style.height = Math.min(window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT, targetRect.height + 42) + "px";
                        setPosition(this.element, targetRect.left, Math.max(top - 42, Constants.SIZE_TOOLBAR_HEIGHT), -42, 0);
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
                observer.observe(item);
            }
        });
        if (this.targetElement) {
            this.targetElement.style.cursor = "";
        }
    }
}
