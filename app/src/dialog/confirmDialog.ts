import {isMobile} from "../util/functions";
import {Dialog} from "./index";

export const confirmDialog = (title: string, text: string, confirm?: () => void, cancel?: () => void) => {
    const dialog = new Dialog({
        title,
        content: `<div class="b3-dialog__content">${text}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text" id="confirmDialogConfirmBtn">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "80vw" : "520px",
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        if (cancel) {
            cancel();
        }
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (confirm) {
            confirm();
        }
        dialog.destroy();
    });
};
