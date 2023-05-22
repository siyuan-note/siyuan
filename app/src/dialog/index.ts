import {genUUID} from "../util/genID";
import {isMobile} from "../util/functions";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Constants} from "../constants";

export class Dialog {
    private destroyCallback: (options?: IObject) => void;
    public element: HTMLElement;
    private id: string;
    private disableClose: boolean;

    constructor(options: {
        title?: string,
        transparent?: boolean,
        content: string,
        width?: string
        height?: string,
        destroyCallback?: (options?: IObject) => void
        disableClose?: boolean
        disableAnimation?: boolean
    }) {
        this.disableClose = options.disableClose;
        this.id = genUUID();
        window.siyuan.dialogs.push(this);
        this.destroyCallback = options.destroyCallback;
        this.element = document.createElement("div") as HTMLElement;

        this.element.innerHTML = `<div class="b3-dialog">
<div class="b3-dialog__scrim"${options.transparent ? 'style="background-color:transparent"' : ""}></div>
<div class="b3-dialog__container" style="width:${options.width || "auto"}">
  <svg ${(isMobile() && options.title) ? 'style="top:0;right:0;"' : ""} class="b3-dialog__close${this.disableClose ? " fn__none" : ""}"><use xlink:href="#iconCloseRound"></use></svg>
  <div class="b3-dialog__header${options.title ? "" : " fn__none"}" onselectstart="return false;">${options.title || ""}</div>
  <div style="height:${options.height || "auto"}">${options.content}</div>
</div></div>`;

        this.element.querySelector(".b3-dialog__scrim").addEventListener("click", (event) => {
            if (!this.disableClose) {
                this.destroy();
            }
            event.preventDefault();
            event.stopPropagation();
            // https://ld246.com/article/1657969292700/comment/1658147006669#comments
            window.siyuan.menus.menu.remove();
        });
        if (!this.disableClose) {
            this.element.querySelector(".b3-dialog__close").addEventListener("click", (event) => {
                this.destroy();
                event.preventDefault();
                event.stopPropagation();
            });
        }
        document.body.append(this.element);
        if (options.disableAnimation) {
            this.element.classList.add("b3-dialog--open");
        } else {
            setTimeout(() => {
                this.element.classList.add("b3-dialog--open");
            });
        }
        /// if !MOBILE
        this.element.addEventListener("mousedown", (event: MouseEvent & { target: HTMLElement }) => {

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
            // https://github.com/siyuan-note/siyuan/issues/6783
            window.siyuan.menus.menu.remove();


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
            };
        });
        /// #endif
    }

    public destroy(options?: IObject) {
        this.element.remove();
        // https://github.com/siyuan-note/siyuan/issues/6783
        window.siyuan.menus.menu.remove();
        if (this.destroyCallback) {
            this.destroyCallback(options);
        }
        window.siyuan.dialogs.find((item, index) => {
            if (item.id === this.id) {
                window.siyuan.dialogs.splice(index, 1);
                return true;
            }
        });
    }

    public bindInput(inputElement: HTMLInputElement | HTMLTextAreaElement, enterEvent?: () => void) {
        inputElement.focus();
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Escape") {
                this.destroy();
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (event.key === "Enter" && enterEvent) {
                enterEvent();
                event.preventDefault();
            }
        });
    }
}
