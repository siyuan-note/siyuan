import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {focusByRange} from "../protyle/util/selection";
import {insertHTML} from "../protyle/util/insertHTML";

export const AIChat = (protyle:IProtyle) => {
    const dialog = new Dialog({
        title: "AI Chat",
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "80vw" : "520px",
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.focus();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/ai/chatGPT", {
            msg: inputElement.value,
        }, (response) => {
            dialog.destroy();
            focusByRange(protyle.toolbar.range);
            let respContent = "";
            if (response.data && "" !== response.data) {
                respContent = "\n\n" + response.data;
            }
            insertHTML(`${inputElement.value}${respContent}`, protyle, true);
        });
    });
};
