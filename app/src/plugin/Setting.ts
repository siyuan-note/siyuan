import {isMobile} from "../util/functions";
import {Dialog} from "../dialog";

export class Setting {
    private items: IPluginSettingOption[] = [];
    private confirmCallback: () => void;
    private destroyCallback: () => void;
    private width: string;
    private height: string;

    constructor(options: {
        height?: string,
        width?: string,
        destroyCallback?: () => void
        confirmCallback?: () => void
    }) {
        this.confirmCallback = options.confirmCallback;
        this.width = options.width || (isMobile() ? "92vw" : "768px");
        this.height = options.height || "80vh";
    }

    public addItem(options: IPluginSettingOption) {
        this.items.push(options);
    }

    public open(name: string) {
        const dialog = new Dialog({
            title: name,
            content: `<div class="b3-dialog__content">
</div>
<div class="b3-dialog__action${this.confirmCallback ? "" : " fn__none"}">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button>
    <div class="fn__space${this.confirmCallback ? "" : " fn__none"}"></div>
    <button class="b3-button b3-button--text${this.confirmCallback ? "" : " fn__none"}">${window.siyuan.languages.save}</button>
</div>`,
            width: this.width,
            height: this.height,
            destroyCallback: () => {
                if (this.destroyCallback) {
                    this.destroyCallback();
                }
            }
        });
        const contentElement = dialog.element.querySelector(".b3-dialog__content");
        this.items.forEach((item) => {
            let html = "";
            let actionElement = item.actionElement;
            if (!item.actionElement && item.createActionElement) {
                actionElement = item.createActionElement();
            }
            const tagName = actionElement?.classList.contains("b3-switch") ? "label" : "div";
            if (typeof item.direction === "undefined") {
                item.direction = "TEXTAREA" === actionElement.tagName ? "row" : "column";
            }
            if (item.direction === "row") {
                html = `<${tagName} class="b3-label">
    <div class="fn__block">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
        <div class="fn__hr"></div>
    </div>
</${tagName}>`;
            } else {
                html = `<${tagName} class="fn__flex b3-label config__item">
    <div class="fn__flex-1">
        ${item.title}
        ${item.description ? `<div class="b3-label__text">${item.description}</div>` : ""}
    </div>
    <span class="fn__space${actionElement ? "" : " fn__none"}"></span>
</${tagName}>`;
            }
            contentElement.insertAdjacentHTML("beforeend", html);
            if (actionElement) {
                if (["INPUT", "TEXTAREA"].includes(actionElement.tagName)) {
                    dialog.bindInput(actionElement as HTMLInputElement, () => {
                        btnsElement[1].dispatchEvent(new CustomEvent("click"));
                    }, actionElement.tagName === "INPUT");
                }
                if (item.direction === "row") {
                    contentElement.lastElementChild.lastElementChild.insertAdjacentElement("beforeend", actionElement);
                    actionElement.classList.add("fn__block");
                } else {
                    actionElement.classList.remove("fn__block");
                    actionElement.classList.add("fn__flex-center", "fn__size200");
                    contentElement.lastElementChild.insertAdjacentElement("beforeend", actionElement);
                }
            }
        });
        (contentElement.querySelector("input, textarea") as HTMLElement)?.focus();
        const btnsElement = dialog.element.querySelectorAll(".b3-dialog__action .b3-button");
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            if (this.confirmCallback) {
                this.confirmCallback();
            }
            dialog.destroy();
        });
    }
}
