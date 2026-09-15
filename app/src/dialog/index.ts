import {genUUID} from "../util/genID";
import {isAbove} from "../util/zIndex";
import {moveResize} from "./moveResize";
import {isMobile} from "../util/functions";
import {isNotCtrl} from "../protyle/util/compatibility";
import {Protyle} from "../protyle";
import {Constants} from "../constants";

export class Dialog {
    private destroyCallback: (options?: IObject) => void;
    public element: HTMLElement;
    private id: string;
    private disableClose: boolean;
    public editors: { [key: string]: Protyle };
    public data: any;
    private resizeCallback: (type: string) => void;
    private previousFocus: HTMLElement;
    private previousRange: Range;
    private destroying = false;
    private trapFocus = (event: KeyboardEvent) => {
        if (event.key !== "Tab" || this.destroying ||
            window.siyuan.dialogs[window.siyuan.dialogs.length - 1] !== this) {
            return;
        }
        // 对话框上方的菜单也需要约束 Tab，避免从菜单末尾进入背景。
        const menu = window.siyuan.menus.menu.element;
        const container = menu.contains(document.activeElement) && isAbove(menu, this.element.querySelector(".b3-dialog")) ?
            menu : this.element.querySelector(".b3-dialog__container") as HTMLElement;
        const elements = Array.from(container.querySelectorAll<HTMLElement>(
            "a[href], button, input, select, textarea, [tabindex], [contenteditable]"
        )).filter(element => (element.tabIndex >= 0 || (element.isContentEditable && !element.hasAttribute("tabindex"))) &&
            !element.matches(":disabled") &&
            !element.closest("[inert]") && element.getClientRects().length &&
            getComputedStyle(element).visibility === "visible");
        elements.sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
        const active = document.activeElement;
        if (!elements.length || !container.contains(active) || active === container ||
            (event.shiftKey ? active === elements[0] : active === elements[elements.length - 1])) {
            event.preventDefault();
            event.stopPropagation();
            (elements.length ? elements[event.shiftKey ? elements.length - 1 : 0] : container).focus({preventScroll: true});
        }
    };

    constructor(options: {
        positionId?: string,
        title?: string,
        transparent?: boolean,
        content: string,
        width?: string,
        height?: string,
        destroyCallback?: (options?: IObject) => void,
        disableClose?: boolean,
        hideCloseIcon?: boolean,
        disableAnimation?: boolean,
        resizeCallback?: (type: string) => void,
        containerClassName?: string
    }) {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && activeElement !== document.body) {
            this.previousFocus = activeElement;
            const selection = window.getSelection();
            if (activeElement.isContentEditable && selection?.rangeCount &&
                activeElement.contains(selection.getRangeAt(0).commonAncestorContainer)) {
                this.previousRange = selection.getRangeAt(0).cloneRange();
            }
        }
        this.resizeCallback = options.resizeCallback;
        this.disableClose = options.disableClose;
        this.id = genUUID();
        window.siyuan.dialogs.push(this);
        this.destroyCallback = options.destroyCallback;
        this.element = document.createElement("div") as HTMLElement;
        let left;
        let top;
        if (!isMobile() && options.positionId) {
            const dialogPosition = window.siyuan.storage[Constants.LOCAL_DIALOGPOSITION][options.positionId];
            if (dialogPosition) {
                if (dialogPosition.left + dialogPosition.width + 34 <= window.innerWidth &&
                    dialogPosition.top + dialogPosition.height <= window.innerHeight) {
                    left = dialogPosition.left + "px";
                    top = dialogPosition.top + "px";
                    options.width = dialogPosition.width + "px";
                    options.height = dialogPosition.height + "px";
                }
            }
        }
        this.element.innerHTML = `<div class="b3-dialog" style="z-index: ${++window.siyuan.zIndex};${typeof left === "string" ? "display:block" : ""}">
<div class="b3-dialog__scrim"${options.transparent ? ' style="background-color:transparent"' : ""}></div>
<div role="dialog" aria-modal="true" ${options.title ? `aria-labelledby="dialog-title-${this.id}" ` : ""}tabindex="-1" class="b3-dialog__container ${options.containerClassName || ""}" style="width:${options.width || "auto"};height:${options.height || "auto"};
left:${left || "auto"};top:${top || "auto"}">
  <svg class="b3-dialog__close${(!isMobile() || this.disableClose || options.hideCloseIcon) ? " fn__none" : ""}"><use xlink:href="#iconCloseRound"></use></svg>
  <div id="dialog-title-${this.id}" class="resize__move b3-dialog__header${options.title ? "" : " fn__none"}" ${(isMobile() &&options.title) ? 'style="padding-right: 38px;"' : ""} onselectstart="return false;">${options.title || ""}</div>
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
        document.addEventListener("keydown", this.trapFocus, true);
        (this.element.querySelector(".b3-dialog__container") as HTMLElement).focus({preventScroll: true});
        if (options.disableAnimation) {
            this.element.classList.add("b3-dialog--open");
        } else {
            setTimeout(() => {
                this.element.classList.add("b3-dialog--open");
            }, Constants.TIMEOUT_OPENDIALOG);
        }
        moveResize(this.element.querySelector(".b3-dialog__container"), options.resizeCallback);
    }

    public resize() {
        if (this.resizeCallback) {
            const containerElement = this.element.querySelector(".b3-dialog__container") as HTMLElement;
            if (containerElement && containerElement.style.maxWidth !== "none") {
                this.resizeCallback("l");
            }
        }
    }

    public destroy(options?: IObject) {
        if (this.destroying) {
            return;
        }
        this.destroying = true;
        document.removeEventListener("keydown", this.trapFocus, true);
        this.element.classList.remove("b3-dialog--open");
        setTimeout(() => {
            // av 修改列头emoji后点击关闭emoji图标
            if (isAbove(window.siyuan.menus.menu.element, this.element.querySelector(".b3-dialog"))) {
                // https://github.com/siyuan-note/siyuan/issues/6783
                window.siyuan.menus.menu.remove();
            }
            const activeElement = document.activeElement;
            const restoreFocus = activeElement === document.body || this.element.contains(activeElement);
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
            // 调用方和上层对话框已接管焦点时，不覆盖其焦点；失效或隐藏的触发元素不再恢复。
            const target = this.previousFocus;
            const topDialog = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
            if (restoreFocus && document.activeElement === document.body && target?.isConnected &&
                target.getClientRects().length && getComputedStyle(target).visibility === "visible" &&
                !target.closest("[inert]") && (!topDialog || topDialog.element.contains(target))) {
                target.focus({preventScroll: true});
                if (document.activeElement === target && this.previousRange?.startContainer.isConnected &&
                    this.previousRange.endContainer.isConnected && target.contains(this.previousRange.commonAncestorContainer)) {
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(this.previousRange);
                }
            }
            // https://github.com/siyuan-note/siyuan/issues/10475
            document.getElementById("drag")?.classList.remove("fn__hidden");
        }, Constants.TIMEOUT_DBLCLICK);
    }

    public bindInput(inputElement: HTMLInputElement | HTMLTextAreaElement, enterEvent?: () => void, bindEnter = true) {
        inputElement.focus();
        let timeStamp: number;
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.isComposing) {
                event.preventDefault();
                return;
            }
            if (event.key === "Escape" && !event.repeat) {
                this.destroy();
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (!event.shiftKey && isNotCtrl(event) && event.key === "Enter" && enterEvent && bindEnter && !event.repeat) {
                if (timeStamp && event.timeStamp - timeStamp < Constants.TIMEOUT_INPUT) {
                    return;
                }
                timeStamp = event.timeStamp;
                enterEvent();
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
}
