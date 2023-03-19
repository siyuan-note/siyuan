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
import {disabledProtyle} from "../protyle/util/onGet";
import {fetchPost} from "../util/fetch";
import {showMessage} from "../dialog/message";

export class BlockPanel {
    public element: HTMLElement;
    public targetElement: HTMLElement;
    public nodeIds: string[];
    public defIds: string[] = [];
    public id: string;
    private stmt: string;
    public editors: Protyle[] = [];
    public esc: () => void;

    // stmt 非空且 id 为空为查询嵌入
    constructor(options: {
        targetElement: HTMLElement,
        nodeIds?: string[],
        defIds?: string[],
        stmt?: string,
        esc?: () => void,
    }) {
        this.id = genUUID();
        this.stmt = options.stmt;
        this.targetElement = options.targetElement;
        this.nodeIds = options.nodeIds;
        this.defIds = options.defIds || [];
        this.esc = options.esc;

        this.element = document.createElement("div");
        this.element.classList.add("block__popover", "block__popover--move", "block__popover--top");

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
        this.element.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {
            document.querySelectorAll(".block__popover--top").forEach(item => {
                item.classList.remove("block__popover--top");
            });
            if (this.element && window.siyuan.blockPanels.length > 1) {
                this.element.classList.add("block__popover--top");
            }
            if (hasClosestByClassName(event.target, "block__icon")) {
                return;
            }
            let iconsElement = hasClosestByClassName(event.target, "block__icons");
            let type = "move";
            let x = event.clientX - parseInt(this.element.style.left);
            let y = event.clientY - parseInt(this.element.style.top);
            const height = this.element.clientHeight;
            const width = this.element.clientWidth;
            if (!iconsElement) {
                x = event.clientX;
                y = event.clientY;
                iconsElement = hasClosestByClassName(event.target, "block__rd") ||
                    hasClosestByClassName(event.target, "block__r") ||
                    hasClosestByClassName(event.target, "block__rt") ||
                    hasClosestByClassName(event.target, "block__d") ||
                    hasClosestByClassName(event.target, "block__l") ||
                    hasClosestByClassName(event.target, "block__ld") ||
                    hasClosestByClassName(event.target, "block__lt") ||
                    hasClosestByClassName(event.target, "block__t");
                if (!iconsElement) {
                    return;
                }
                type = iconsElement.className;
            }
            const documentSelf = document;
            this.element.style.userSelect = "none";

            documentSelf.ondragstart = () => false;

            documentSelf.onmousemove = (moveEvent: MouseEvent) => {
                if (!this.element) {
                    return;
                }
                if (type === "move") {
                    let positionX = moveEvent.clientX - x;
                    let positionY = moveEvent.clientY - y;
                    if (positionX > window.innerWidth - width) {
                        positionX = window.innerWidth - width;
                    }
                    if (positionY > window.innerHeight - height) {
                        positionY = window.innerHeight - height;
                    }
                    this.element.style.left = Math.max(positionX, 0) + "px";
                    this.element.style.top = Math.max(positionY, Constants.SIZE_TOOLBAR_HEIGHT) + "px";
                } else {
                    if (type === "block__r" &&
                        moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth) {
                        this.element.style.width = moveEvent.clientX - x + width + "px";
                    } else if (type === "block__d" &&
                        moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                        this.element.style.height = moveEvent.clientY - y + height + "px";
                        this.element.style.maxHeight = "";
                    } else if (type === "block__t" &&
                        moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                        this.element.style.top = moveEvent.clientY + "px";
                        this.element.style.maxHeight = "";
                        this.element.style.height = (y - moveEvent.clientY + height) + "px";
                    } else if (type === "block__l" &&
                        moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200) {
                        this.element.style.left = moveEvent.clientX + "px";
                        this.element.style.width = (x - moveEvent.clientX + width) + "px";
                    } else if (type === "block__rd" &&
                        moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth &&
                        moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                        this.element.style.height = moveEvent.clientY - y + height + "px";
                        this.element.style.maxHeight = "";
                        this.element.style.width = moveEvent.clientX - x + width + "px";
                    } else if (type === "block__rt" &&
                        moveEvent.clientX - x + width > 200 && moveEvent.clientX - x + width < window.innerWidth &&
                        moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                        this.element.style.width = moveEvent.clientX - x + width + "px";
                        this.element.style.top = moveEvent.clientY + "px";
                        this.element.style.maxHeight = "";
                        this.element.style.height = (y - moveEvent.clientY + height) + "px";
                    } else if (type === "block__lt" &&
                        moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200 &&
                        moveEvent.clientY > Constants.SIZE_TOOLBAR_HEIGHT && y - moveEvent.clientY + height > 160) {
                        this.element.style.left = moveEvent.clientX + "px";
                        this.element.style.width = (x - moveEvent.clientX + width) + "px";
                        this.element.style.top = moveEvent.clientY + "px";
                        this.element.style.maxHeight = "";
                        this.element.style.height = (y - moveEvent.clientY + height) + "px";
                    } else if (type === "block__ld" &&
                        moveEvent.clientX > 0 && x - moveEvent.clientX + width > 200 &&
                        moveEvent.clientY - y + height > 160 && moveEvent.clientY - y + height < window.innerHeight - Constants.SIZE_TOOLBAR_HEIGHT) {
                        this.element.style.left = moveEvent.clientX + "px";
                        this.element.style.width = (x - moveEvent.clientX + width) + "px";
                        this.element.style.height = moveEvent.clientY - y + height + "px";
                        this.element.style.maxHeight = "";
                    }
                }
            };

            documentSelf.onmouseup = () => {
                if (!this.element) {
                    return;
                }
                if (window.siyuan.dragElement) {
                    // 反向链接拖拽 https://ld246.com/article/1632915506502
                    window.siyuan.dragElement.style.opacity = "";
                    window.siyuan.dragElement = undefined;
                }
                this.element.style.userSelect = "auto";
                documentSelf.onmousemove = null;
                documentSelf.onmouseup = null;
                documentSelf.ondragstart = null;
                documentSelf.onselectstart = null;
                documentSelf.onselect = null;
                if (type !== "move") {
                    this.editors.forEach(item => {
                        setPadding(item.protyle);
                    });
                } else {
                    const pinElement = this.element.firstElementChild.querySelector('[data-type="pin"]');
                    pinElement.classList.add("block__icon--active");
                    pinElement.setAttribute("aria-label", window.siyuan.languages.unpin);
                    this.element.setAttribute("data-pin", "true");
                }
            };
        });

        this.targetElement.style.cursor = "wait";

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
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.classList.contains("block__icon") || target.classList.contains("block__logo")) {
                    const type = target.getAttribute("data-type");
                    if (type === "close" && this.targetElement) {
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
        this.render();
    }

    private initProtyle(editorElement: HTMLElement) {
        const index = parseInt(editorElement.getAttribute("data-index"));
        fetchPost("api/block/getBlockInfo", {id: this.nodeIds[index]}, (response) => {
            if (response.code === 3) {
                showMessage(response.msg);
                return;
            }
            if (!this.targetElement) {
                return;
            }
            const action = [];
            if (response.data.rootID !== this.nodeIds[index]) {
                action.push(Constants.CB_GET_ALL);
            }
            if (this.targetElement.classList.contains("protyle-attr--refcount") ||
                this.targetElement.classList.contains("counter")) {
                action.push(Constants.CB_GET_BACKLINK);
            }
            const editor = new Protyle(editorElement, {
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
                        editor.protyle.breadcrumb.element.parentElement.insertAdjacentHTML("beforeend", `<span class="fn__space"></span>
<div class="b3-tooltips b3-tooltips__w block__icon block__icon--show fn__flex-center" data-type="context" aria-label="${window.siyuan.languages.context}"><svg><use xlink:href="#iconAlignCenter"></use></svg></div>`);
                    }
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
            openHTML = `<span data-type="open" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.openByNewWindow}"><svg><use xlink:href="#iconOpenWindow"></use></svg></span>
<span class="fn__space"></span>`;
        }
        /// #endif
        let html = `<div class="block__icons block__icons--border">
    <span class="fn__space fn__flex-1"></span>${openHTML}
    <span data-type="pin" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.pin}"><svg><use xlink:href="#iconPin"></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="close" class="block__icon b3-tooltips b3-tooltips__sw" aria-label="${window.siyuan.languages.close}"><svg style="width: 10px"><use xlink:href="#iconClose"></use></svg></span>
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
            html += '</div><div class="block__rd"></div><div class="block__ld"></div><div class="block__lt"></div><div class="block__rt"></div><div class="block__r"></div><div class="block__d"></div><div class="block__t"></div><div class="block__l"></div>';
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
                this.initProtyle(item);
            } else {
                observer.observe(item);
            }
        });
        this.targetElement.style.cursor = "";
        this.element.classList.add("block__popover--open");
        let targetRect;
        if (this.targetElement.classList.contains("protyle-wysiwyg__embed")) {
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
            setPosition(this.element, targetRect.left, Math.max(top - 84, Constants.SIZE_TOOLBAR_HEIGHT), 0, 8);
        } else {
            if (this.targetElement.classList.contains("pdf__rect")) {
                targetRect = this.targetElement.firstElementChild.getBoundingClientRect();
            } else {
                targetRect = this.targetElement.getBoundingClientRect();
            }
            // 靠边不宜拖拽 https://github.com/siyuan-note/siyuan/issues/2937
            setPosition(this.element, targetRect.left, targetRect.top + targetRect.height + 4, targetRect.height + 12, 8);
        }

        this.element.style.maxHeight = (window.innerHeight - this.element.getBoundingClientRect().top - 8) + "px";
    }
}
