import {transaction} from "./transaction";
import {focusByRange} from "../util/selection";
import {Dialog} from "../../dialog";
import {Menu} from "../../plugin/Menu";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";

export const updateCalloutType = (blockElements: HTMLElement[], protyle: IProtyle) => {
    if (blockElements.length === 0) {
        return;
    }
    const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : null;
    const blockCalloutElement = blockElements[0].querySelector(".callout-icon");
    const dialog = new Dialog({
        title: window.siyuan.languages.callout,
        content: `<div class="b3-dialog__content">
    <label class="fn__flex">
        <div class="fn__flex-center">
            ${window.siyuan.languages.icon}
        </div>
        <span class="fn__space"></span>
        <div class="protyle-wysiwyg" style="padding: 0" data-readonly="false">
            <span class="callout-icon">${blockCalloutElement.innerHTML}</span>
        </div>
    </label>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center">
            ${window.siyuan.languages.type}
        </div>
        <span class="fn__space"></span>
        <div class="b3-form__icona fn__flex-1">
            <input value="${blockElements[0].getAttribute("data-subtype")}" type="text" class="b3-text-field fn__block b3-form__icona-input">
            <svg class="b3-form__icona-icon"><use xlink:href="#iconDown"></use></svg>
        </div>
    </label>
    <div class="fn__hr"></div>
    <label class="fn__flex">
        <div class="fn__flex-center">
            ${window.siyuan.languages.title}
        </div>
        <span class="fn__space"></span>
        <input class="b3-text-field fn__flex-1" type="text">
    </label>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        destroyCallback() {
            if (range) {
                focusByRange(range);
            }
        }
    });
    const btnElements = dialog.element.querySelectorAll(".b3-button");
    btnElements[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnElements[1].addEventListener("click", () => {
        const doOperations: IOperation[] = [];
        const undoOperations: IOperation[] = [];
        blockElements.filter(item => {
            const id = item.getAttribute("data-node-id");
            const oldHTML = item.outerHTML;
            item.setAttribute("data-subtype", textElements[0].value.trim());
            let title = textElements[1].value.trim();
            if (title) {
                const template = document.createElement("template");
                template.innerHTML = protyle.lute.Md2BlockDOM(textElements[1].value.trim());
                title = template.content.firstElementChild.firstElementChild.innerHTML;
            }
            item.querySelector(".callout-title").innerHTML = title ||
                (textElements[0].value.trim().substring(0, 1).toUpperCase() + textElements[0].value.trim().substring(1).toLowerCase());
            item.querySelector(".callout-icon").innerHTML = dialogCalloutIconElement.innerHTML;
            doOperations.push({
                id,
                data: item.outerHTML,
                action: "update"
            });
            undoOperations.push({
                id,
                data: oldHTML,
                action: "update"
            });
        });
        transaction(protyle, doOperations, undoOperations);
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
    textElements[1].value = protyle.lute.BlockDOM2StdMd(blockElements[0].querySelector(".callout-title").innerHTML);
    const dialogCalloutIconElement = dialog.element.querySelector(".callout-icon");
    dialogCalloutIconElement.addEventListener("click", () => {
        const emojiRect = dialogCalloutIconElement.getBoundingClientRect();
        openEmojiPanel("", "av", {
            x: emojiRect.left,
            y: emojiRect.bottom,
            h: emojiRect.height,
            w: emojiRect.width
        }, (unicode) => {
            let emojiHTML;
            if (unicode.startsWith("api/icon/getDynamicIcon")) {
                emojiHTML = `<img class="callout-img" src="${unicode}"/>`;
            } else if (unicode.indexOf(".") > -1) {
                emojiHTML = `<img class="callout-img" src="/emojis/${unicode}">`;
            } else {
                emojiHTML = unicode2Emoji(unicode);
            }
            if (unicode === "") {
                if (textElements[0].value === "NOTE") {
                    emojiHTML = "✏️";
                } else if (textElements[0].value === "TIP") {
                    emojiHTML = "💡";
                } else if (textElements[0].value === "IMPORTANT") {
                    emojiHTML = "❗";
                } else if (textElements[0].value === "WARNING") {
                    emojiHTML = "⚠️";
                } else if (textElements[0].value === "CAUTION") {
                    emojiHTML = "🚨";
                }
            }
            dialogCalloutIconElement.innerHTML = emojiHTML;
        }, dialogCalloutIconElement.querySelector("img"));
    });
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
                    dialogCalloutIconElement.innerHTML = item.icon;
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
