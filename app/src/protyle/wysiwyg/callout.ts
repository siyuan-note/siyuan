import {hasClosestBlock} from "../util/hasClosest";
import {updateTransaction} from "./transaction";
import {focusBlock} from "../util/selection";
import {Dialog} from "../../dialog";
import {escapeHtml} from "../../util/escape";
import {Menu} from "../../plugin/Menu";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";

export const updateCalloutType = (titleElement: HTMLElement, protyle: IProtyle) => {
    const blockElement = hasClosestBlock(titleElement);
    if (!blockElement) {
        return;
    }
    const dialog = new Dialog({
        title: window.siyuan.languages.callout,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex">
        <div class="fn__flex-center">
            ${window.siyuan.languages.type}
        </div>
        <span class="fn__space"></span>
        <div class="b3-form__icona fn__flex-1">
            <input value="${blockElement.getAttribute("data-subtype")}" type="text" class="b3-text-field fn__block b3-form__icona-input">
            <svg class="b3-form__icona-icon"><use xlink:href="#iconDown"></use></svg>
        </div>
    </label>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center">
            ${window.siyuan.languages.title}
        </div>
        <span class="fn__space"></span>
        <input class="b3-text-field fn__flex-1" value="${titleElement.textContent}" type="text">
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const btnElements = dialog.element.querySelectorAll(".b3-button");
    btnElements[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnElements[1].addEventListener("click", () => {
        const oldHTML = blockElement.outerHTML;
        blockElement.setAttribute("data-subtype", textElements[0].value.trim());
        titleElement.textContent = escapeHtml(textElements[1].value.trim() ||
            (textElements[0].value.trim().substring(0, 1).toUpperCase() + textElements[0].value.trim().substring(1).toLowerCase()));
        if (updateIcon) {
            blockElement.querySelector(".callout-icon").textContent = updateIcon;
        }
        updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
        focusBlock(blockElement);
        dialog.destroy();
    });
    const textElements: NodeListOf<HTMLInputElement> = dialog.element.querySelectorAll(".b3-text-field");
    dialog.bindInput(textElements[1], () => {
        btnElements[1].dispatchEvent(new CustomEvent("click"));
    });
    textElements[0].addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (event.key.startsWith("Arrow")) {
            dialog.element.querySelector(".b3-form__icona-icon").dispatchEvent(new CustomEvent("click"));
            textElements[0].blur();
            event.preventDefault();
            event.stopPropagation();
        }
    });
    textElements[0].focus();
    textElements[0].select();
    let updateIcon = "";
    dialog.element.querySelector(".b3-form__icona-icon").addEventListener("click", (event) => {
        const menu = new Menu(Constants.MENU_CALLOUT_SELECT, () => {
            if (document.activeElement.tagName === "BODY") {
                textElements[0].focus();
            }
        });
        if (menu.isOpen) {
            menu.close();
            return;
        }
        [{
            icon: "✏️", type: "Note", color: "var(--b3-callout-note)"
        }, {
            icon: "💡", type: "Tip", color: "var(--b3-callout-tip)"
        }, {
            icon: "❗", type: "Important", color: "var(--b3-callout-important)"
        }, {
            icon: "⚠️", type: "Warning", color: "var(--b3-callout-warning)"
        }, {
            icon: "🚨", type: "Caution", color: "var(--b3-callout-caution)"
        }].forEach((item) => {
            menu.addItem({
                iconHTML: `<span class="b3-menu__icon">${item.icon.toUpperCase()}</span>`,
                label: `<span style="color: ${item.color}">${item.type}</span>`,
                click() {
                    if (textElements[0].value.toLowerCase() === textElements[1].value.toLowerCase()) {
                        textElements[1].value = item.type;
                    }
                    textElements[0].value = item.type.toUpperCase();
                    updateIcon = item.icon;
                    textElements[1].focus();
                    textElements[1].select();
                }
            });
        });
        const inputRect = textElements[0].getBoundingClientRect();
        menu.open({
            x: inputRect.left,
            y: inputRect.bottom
        });
        event.stopPropagation();
        event.preventDefault();
    });
};
