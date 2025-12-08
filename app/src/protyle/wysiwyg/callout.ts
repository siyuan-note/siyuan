import {hasClosestBlock} from "../util/hasClosest";
import {updateTransaction} from "./transaction";
import {focusBlock} from "../util/selection";
import {Dialog} from "../../dialog";
import {escapeHtml} from "../../util/escape";
import {Menu} from "../../plugin/Menu";

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
</div>`,
        width: "520px",
        destroyCallback() {
            const oldHTML = blockElement.outerHTML;
            blockElement.setAttribute("data-subtype", textElements[0].value.trim());
            titleElement.textContent = escapeHtml(textElements[1].value);
            if (updateIcon) {
                blockElement.querySelector(".callout-icon").textContent = updateIcon;
            }
            updateTransaction(protyle, blockElement.getAttribute("data-node-id"), blockElement.outerHTML, oldHTML);
            focusBlock(blockElement);
        }
    });
    const textElements: NodeListOf<HTMLInputElement> = dialog.element.querySelectorAll(".b3-text-field");
    let updateIcon = "";
    dialog.element.querySelector(".b3-form__icona-icon").addEventListener("click", (event) => {
        const menu = new Menu();
        [{
            icon: "✏️", type: "NOTE"
        }, {
            icon: "💡", type: "TIP"
        }, {
            icon: "❗", type: "IMPORTANT"
        }, {
            icon: "⚠️", type: "WARNING"
        }, {
            icon: "🚨", type: "CAUTION"
        }].forEach(item => {
            menu.addItem({
                iconHTML: `<span class="b3-menu__icon">${item.icon}</span>`,
                label: item.type,
                click() {
                    textElements[0].value = item.type;
                    textElements[1].value = item.type;
                    updateIcon = item.icon;
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
