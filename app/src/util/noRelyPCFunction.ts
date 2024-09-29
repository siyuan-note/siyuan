import {Dialog} from "../dialog";
import {fetchPost} from "./fetch";
import {isMobile} from "./functions";
import {Constants} from "../constants";
import {pathPosix} from "./pathName";

// 需独立出来，否则移动端引用的时候会引入 pc 端大量无用代码
export const renameTag = (labelName: string) => {
    const dialog = new Dialog({
        title: window.siyuan.languages.rename,
        content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value="${labelName}"></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_RENAMETAG);
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    const inputElement = dialog.element.querySelector("input");
    dialog.bindInput(inputElement, () => {
        (btnsElement[1] as HTMLButtonElement).click();
    });
    inputElement.focus();
    inputElement.select();
    btnsElement[1].addEventListener("click", () => {
        fetchPost("/api/tag/renameTag", {oldLabel: labelName, newLabel: inputElement.value});
    });
};

export const getWorkspaceName = () => {
    return pathPosix().basename(window.siyuan.config.system.workspaceDir.replace(/\\/g, "/"));
};

export const checkFold = (id: string, cb: (zoomIn: boolean, action: string[], isRoot: boolean) => void) => {
    if (!id) {
        return;
    }
    fetchPost("/api/block/checkBlockFold", {id}, (foldResponse) => {
        cb(foldResponse.data.isFolded,
            foldResponse.data.isFolded ? [Constants.CB_GET_FOCUS, Constants.CB_GET_ALL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
            foldResponse.data.isRoot);
    });
};
