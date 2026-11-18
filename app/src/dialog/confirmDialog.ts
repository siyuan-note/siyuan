import {isMobile} from "../util/functions";
import {Dialog} from "./index";
import {MobileDialog, MobileSheetOptions} from "./mobileDialog";
import {Constants} from "../constants";

export interface IConfirmDialogOptions {
    /** 与 text 不能同时为空；需要不打断用户时由调用方直接执行动作 */
    title: string;
    text: string;
    /**
     * 移动端 awaitConfirm 时返回 true 才关闭；桌面端忽略返回值，调用后立即关闭。
     */
    confirm?: (dialog?: Dialog) => void | boolean | Promise<void | boolean>;
    cancel?: (dialog: Dialog) => void;
    isDelete?: boolean;
    extraAction?: {label: string, callback: () => void};
    /** 确认按钮文字，优先于 isDelete 的默认文案 */
    confirmLabel?: string;
    /** 取消按钮文字，默认使用「取消」 */
    cancelLabel?: string;
    /** 移动端等待 confirm 完成并返回 true 后才关闭，失败时保留对话框 */
    awaitConfirm?: boolean;
    mobileSheet?: MobileSheetOptions;
}

// 桌面实现单独导出，插件 API 按位置参数调用它，避免插件跟随移动端适配变化。
export const createDesktopConfirmDialog = (options: IConfirmDialogOptions) => {
    const {title, text, confirm, cancel, isDelete = false, extraAction, confirmLabel, cancelLabel} = options;
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
    <button class="b3-button b3-button--cancel" id="cancelDialogConfirmBtn">${cancelLabel || window.siyuan.languages.cancel}</button><div class="fn__space"></div>
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
    return dialog;
};

const createMobileConfirmDialog = (options: IConfirmDialogOptions) => {
    const {title, text, confirm, cancel, isDelete = false, extraAction, confirmLabel, cancelLabel} = options;
    const previousActiveElement = document.activeElement as HTMLElement;
    let handled = false;
    const handleCancel = () => {
        if (handled) {
            return;
        }
        handled = true;
        cancel?.(dialog);
    };
    const dialog = new MobileDialog({
        title,
        mobileSheet: options.mobileSheet,
        content: `<div class="b3-dialog__content">
    <div class="ft__breakword">${text}</div>
</div>
<div class="b3-dialog__action mobile-sheet-action-bar">
    <div class="mobile-sheet-action-group${extraAction ? " mobile-sheet-action-group--stacked" : ""}">
        <button class="b3-button b3-button--touch b3-button--wrap b3-button--cancel b3-button--secondary" id="cancelDialogConfirmBtn">${cancelLabel || window.siyuan.languages.cancel}</button>
        <button class="b3-button b3-button--touch b3-button--wrap ${isDelete ? "b3-button--remove" : ""}" id="confirmDialogConfirmBtn">${confirmLabel || window.siyuan.languages[isDelete ? "delete" : "confirm"]}</button>
    </div>
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
        button.className = "b3-button b3-button--touch b3-button--wrap b3-button--text";
        button.id = "extraDialogConfirmBtn";
        button.textContent = extraAction.label;
        dialog.element.querySelector("#confirmDialogConfirmBtn").before(button);
    }
    dialog.element.setAttribute("data-key", Constants.DIALOG_CONFIRM);
    dialog.focusWhenReady(() => dialog.element.querySelector("#confirmDialogConfirmBtn"));
    return dialog;
};

export const confirmDialog = (options: IConfirmDialogOptions) =>
    isMobile() ? createMobileConfirmDialog(options) : createDesktopConfirmDialog(options);
