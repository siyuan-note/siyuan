import {isMobile} from "../util/functions";
import {MobileDialog as Dialog, MobileSheetOptions} from "./mobileDialog";
import {confirmDialog} from "./confirmDialog";
import {Constants} from "../constants";

export const mobileConfirmDialog = (title: string, text: string,
                              confirm?: (dialog?: Dialog) => void | boolean | Promise<void | boolean>,
                              cancel?: (dialog: Dialog) => void,
                              isDelete = false,
                              extraAction?: {label: string, callback: () => void}, confirmLabel?: string, options: {awaitConfirm?: boolean, mobileSheet?: MobileSheetOptions} = {}) => {
    if (!isMobile()) return confirmDialog(title, text, confirm, cancel, isDelete, extraAction, confirmLabel) as Dialog;
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
        mobileSheet: options.mobileSheet,
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
                void dialog.requestClose(isDispatch ? "escape" : "cancel");
                break;
            } else if (target.id === "extraDialogConfirmBtn") {
                handled = true;
                extraAction?.callback();
                dialog.destroy();
                break;
            } else if (target.id === "confirmDialogConfirmBtn" || (isDispatch && event.detail=== "Enter")) {
                if (options.awaitConfirm) {
                    void dialog.runPending(async () => {
                        const success = await confirm?.(dialog) === true;
                        if (success) handled = true;
                        return success;
                    });
                } else {
                    handled = true;
                    confirm?.(dialog);
                    void dialog.requestClose("confirm");
                }
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
    dialog.focusWhenReady(() => dialog.element.querySelector("#confirmDialogConfirmBtn"));
    return dialog;
};
