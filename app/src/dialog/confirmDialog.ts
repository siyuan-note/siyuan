import {isMobile} from "../util/functions";
import {Dialog} from "./index";
import {Constants} from "../constants";

export const confirmDialog = (title: string, text: string,
                              confirm?: (dialog?: Dialog) => void,
                              cancel?: (dialog: Dialog) => void,
                              isDelete = false,
                              extraAction?: {label: string, callback: () => void}, confirmLabel?: string) => {
    if (!text && !title) {
        confirm();
        return;
    }
    const previousActiveElement = document.activeElement as HTMLElement;
    let handled = false;
    const handleCancel = () => {
        if (handled) {
            return;
        }
        handled = true;
        cancel?.(dialog);
    };
    const dialog = new Dialog({
        title,
        content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${text}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel" id="cancelDialogConfirmBtn">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button ${isDelete ? "b3-button--remove" : "b3-button--text"}" id="confirmDialogConfirmBtn">${confirmLabel || window.siyuan.languages[isDelete ? "delete" : "confirm"]}</button>
</div>`,
        width: isMobile() ? "92vw" : "520px",
        destroyCallback: () => {
            handleCancel();
            if (!previousActiveElement?.isConnected) {
                return;
            }
            const activeElement = document.activeElement as HTMLElement;
            if (!activeElement || activeElement === document.body) {
                previousActiveElement.focus({preventScroll: true});
            }
        },
    });

    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        const isDispatch = typeof event.detail === "string";
        while (target && target !== dialog.element || isDispatch) {
            if (target.id === "cancelDialogConfirmBtn" || (isDispatch && event.detail=== "Escape")) {
                handleCancel();
                dialog.destroy();
                break;
            } else if (target.id === "extraDialogConfirmBtn") {
                handled = true;
                extraAction?.callback();
                dialog.destroy();
                break;
            } else if (target.id === "confirmDialogConfirmBtn" || (isDispatch && event.detail=== "Enter")) {
                handled = true;
                confirm?.(dialog);
                dialog.destroy();
                break;
            }
            target = target.parentElement;
        }
    });
    if (extraAction) {
        const button = document.createElement("button");
        button.className = "b3-button b3-button--text";
        button.id = "extraDialogConfirmBtn";
        button.textContent = extraAction.label;
        const space = document.createElement("div");
        space.className = "fn__space";
        dialog.element.querySelector("#confirmDialogConfirmBtn").before(button, space);
    }
    dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
    (dialog.element.querySelector("#confirmDialogConfirmBtn") as HTMLButtonElement).focus({preventScroll: true});
};
