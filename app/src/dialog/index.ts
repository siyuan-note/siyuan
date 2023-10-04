import {genUUID} from "../util/genID";
/// #if !MOBILE
import {moveResize} from "./moveResize";
/// #endif
import {isMobile} from "../util/functions";
import {isCtrl} from "../protyle/util/compatibility";
import {Protyle} from "../protyle";

export class Dialog {
    private destroyCallback: (options?: IObject) => void;
    public element: HTMLElement;
    private id: string;
    private disableClose: boolean;
    public editor: Protyle;

    constructor(options: {
        title?: string,
        transparent?: boolean,
        content: string,
        width?: string,
        height?: string,
        destroyCallback?: (options?: IObject) => void,
        disableClose?: boolean,
        hideCloseIcon?: boolean,
        disableAnimation?: boolean,
        resizeCallback?: (type: string) => void
    }) {
        this.disableClose = options.disableClose;
        this.id = genUUID();
        window.siyuan.dialogs.push(this);
        this.destroyCallback = options.destroyCallback;
        this.element = document.createElement("div") as HTMLElement;

        this.element.innerHTML = `<div class="b3-dialog" style="z-index: ${++window.siyuan.zIndex};">
<div class="b3-dialog__scrim"${options.transparent ? 'style="background-color:transparent"' : ""}></div>
<div class="b3-dialog__container" style="width:${options.width || "auto"};height:${options.height || "auto"}">
  <svg ${(isMobile() && options.title) ? 'style="top:0;right:0;"' : ""} class="b3-dialog__close${(this.disableClose||options.hideCloseIcon) ? " fn__none" : ""}"><use xlink:href="#iconCloseRound"></use></svg>
  <div class="resize__move b3-dialog__header${options.title ? "" : " fn__none"}" onselectstart="return false;">${options.title || ""}</div>
  <div class="b3-dialog__body">${options.content}</div>
  <div class="resize__rd"></div><div class="resize__ld"></div><div class="resize__lt"></div><div class="resize__rt"></div><div class="resize__r"></div><div class="resize__d"></div><div class="resize__t"></div><div class="resize__l"></div>
</div></div>`;

        this.element.querySelector(".b3-dialog__scrim").addEventListener("click", (event) => {
            if (!this.disableClose) {
                this.destroy();
            }
            event.preventDefault();
            event.stopPropagation();
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
        /// #if !MOBILE
        moveResize(this.element.querySelector(".b3-dialog__container"), options.resizeCallback);
        /// #endif
    }

    public destroy(options?: IObject) {
        // av 修改列头emoji后点击关闭emoji图标
        if ((this.element.querySelector(".b3-dialog") as HTMLElement).style.zIndex < window.siyuan.menus.menu.element.style.zIndex) {
            // https://github.com/siyuan-note/siyuan/issues/6783
            window.siyuan.menus.menu.remove();
        }
        this.element.remove();
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
            const confirmElement = document.querySelector("#confirmDialogConfirmBtn");
            if (event.key === "Escape") {
                if (confirmElement) {
                    confirmElement.previousElementSibling.previousElementSibling.dispatchEvent(new CustomEvent("click"));
                } else {
                    this.destroy();
                }
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (!event.shiftKey && !isCtrl(event) && event.key === "Enter" && enterEvent) {
                if (confirmElement) {
                    confirmElement.dispatchEvent(new CustomEvent("click"));
                } else {
                    enterEvent();
                }
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
}
