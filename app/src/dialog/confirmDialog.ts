import {isMobile} from "../util/functions";
import {Dialog} from "./index";
import {AdaptiveDialog, MobileSheetOptions} from "./adaptiveDialog";
import {Constants} from "../constants";
import {showMessage} from "./message";

/**
 * 确认按钮处理器。
 * 返回 false 或抛出错误时不关闭对话框并恢复按钮，其余结果都视为成功。
 */
export type TConfirmDialogHandler = (dialog?: Dialog) => boolean | void | Promise<boolean | void>;

export interface IConfirmDialogOptions {
    title: string;
    text: string;
    /** 桌面端与移动端都会等待其完成，失败时保留对话框 */
    confirm?: TConfirmDialogHandler;
    cancel?: (dialog: Dialog) => void;
    isDelete?: boolean;
    extraAction?: {label: string, callback: () => void};
    /** 确认按钮文字，优先于 isDelete 的默认文案 */
    confirmLabel?: string;
    /** 取消按钮文字，默认使用「取消」 */
    cancelLabel?: string;
    /** Use the exit progress backdrop without fading in a new scrim. Desktop only. */
    frostedScrim?: boolean;
    mobileSheet?: MobileSheetOptions;
}

// 等待 confirm 完成期间禁用按钮，失败时恢复；成功才关闭对话框。
const runConfirm = async (dialog: Dialog, confirm?: TConfirmDialogHandler) => {
    if (!confirm) {
        return true;
    }
    const buttons = Array.from(dialog.element.querySelectorAll<HTMLButtonElement>("button"))
        .filter(button => !button.disabled);
    buttons.forEach(button => {
        button.disabled = true;
    });
    let success = false;
    try {
        success = await confirm(dialog) !== false;
    } catch (error) {
        console.error(error);
        showMessage(window.siyuan.languages.confirmActionFailed);
    } finally {
        buttons.forEach(button => {
            if (button.isConnected) {
                button.disabled = false;
            }
        });
    }
    return success;
};

// 桌面实现单独导出，插件 API 按位置参数调用它，避免插件跟随移动端适配变化。
export const createDesktopConfirmDialog = (options: IConfirmDialogOptions) => {
    const {title, text, confirm, cancel, isDelete = false, extraAction, confirmLabel, cancelLabel} = options;
    const previousActiveElement = document.activeElement as HTMLElement;
    let handled = false;
    let pending = false;
    let destroyed = false;
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
        beforeClose: () => !pending,
        destroyCallback: () => {
            destroyed = true;
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

    if (options.frostedScrim) {
        const scrim = dialog.element.querySelector<HTMLElement>(".b3-dialog__scrim");
        scrim.classList.add("b3-dialog__scrim--frosted");
        scrim.style.opacity = "1";
    }

    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        const isDispatch = typeof event.detail === "string";
        if (pending || destroyed) {
            return;
        }
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
                pending = true;
                void runConfirm(dialog, confirm).then(success => {
                    pending = false;
                    if (!success || destroyed) {
                        return;
                    }
                    handled = true;
                    dialog.destroy();
                });
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

const createSheetConfirmDialog = (options: IConfirmDialogOptions) => {
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
    const dialog = new AdaptiveDialog({
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
                // 移动端沿用 runPending 的整页锁定与错误提示，保证底部 sheet 期间不能继续编辑
                void dialog.runPending(async () => {
                    const success = confirm ? await confirm(dialog) !== false : true;
                    if (success) handled = true;
                    return success;
                }, {failureMessage: window.siyuan.languages.confirmActionFailed});
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
    isMobile() ? createSheetConfirmDialog(options) : createDesktopConfirmDialog(options);
