import {MenuItem} from "./Menu";
import {Dialog} from "../dialog";
import {isMobile} from "../util/functions";
import {fetchPost} from "../util/fetch";

export const transferBlockRef = (id: string) => {
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.transferBlockRef,
        icon: "iconScrollHoriz",
        click() {
            const renameDialog = new Dialog({
                title: window.siyuan.languages.transferBlockRef,
                content: `<div class="b3-dialog__content">
    <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.targetBlockID}">
    <div class="b3-label__text">${window.siyuan.languages.transferBlockRefTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                width: isMobile() ? "92vw" : "520px",
            });
            const inputElement = renameDialog.element.querySelector("input") as HTMLInputElement;
            const btnsElement = renameDialog.element.querySelectorAll(".b3-button");
            renameDialog.bindInput(inputElement, () => {
                (btnsElement[1] as HTMLButtonElement).click();
            });
            inputElement.focus();
            btnsElement[0].addEventListener("click", () => {
                renameDialog.destroy();
            });
            btnsElement[1].addEventListener("click", () => {
                fetchPost("/api/block/transferBlockRef", {
                    fromID: id,
                    toID: inputElement.value,
                });
                renameDialog.destroy();
            });
        }
    }).element);
};
