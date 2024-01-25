import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";
import {fillContent} from "./actions";

export const AIChat = (protyle: IProtyle, element: Element) => {
    const dialog = new Dialog({
        title: "AI Chat",
        content: `<div class="b3-dialog__content"><textarea class="b3-text-field fn__block"></textarea></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    const inputElement = dialog.element.querySelector("textarea");
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.focus();
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        let inputValue = inputElement.value;
        fetchPost("/api/ai/chatGPT", {
            msg: inputValue,
        }, (response) => {
            dialog.destroy();
            let respContent = "";
            if (response.data && "" !== response.data) {
                respContent = "\n\n" + response.data;
            }
            if (inputValue === "Clear context") {
                inputValue = "";
            }
            fillContent(protyle, `${inputValue}${respContent}`, [element]);
        });
    });
};
