import {MobileDialog as Dialog, MobileSheetOptions} from "./mobileDialog";
import {createInputDialog} from "./inputDialog";
import {isMobile} from "../util/functions";
import {escapeHtml} from "../util/escape";

export const mobileInputDialog = (options: {
    compactActions?: boolean,
    mobileSheet?: MobileSheetOptions,
    awaitConfirm?: boolean,
    title: string,
    value: string,
    label?: string,
    width?: string,
    positionId?: string,
    maxLength?: number,
    type?: "text" | "number" | "password" | "date",
    multiline?: boolean,
    resize?: "none" | "vertical",
    min?: string,
    max?: string,
    step?: string,
    placeholder?: string,
    // 说明沿用现有本地化文案的 HTML 语义。
    description?: string,
    // 附加控件由调用方提供可信 HTML 并绑定交互。
    prefixContent?: string,
    extraContent?: string,
    confirmText?: string,
    actions?: {
        text: string,
        position?: "beforeCancel" | "beforeConfirm" | "afterConfirm",
        danger?: boolean,
        onClick: (value: string, dialog: Dialog) => void,
    }[],
    // 自动补全等入口可自行处理输入框键盘事件。
    bindInput?: boolean,
    onConfirm: (value: string, dialog: Dialog) => void | boolean | Promise<void | boolean>,
    destroyCallback?: (options?: IObject) => void,
}): Dialog => {
    if (!isMobile()) {
        return createInputDialog({...options, onConfirm: (value, dialog) => {
            const result = options.onConfirm(value, dialog as Dialog);
            if (options.awaitConfirm) void Promise.resolve(result).then(success => {
                if (success === true) dialog.destroy();
            }).catch(error => console.error(error));
        }}, Dialog) as Dialog;
    }
    const inputHTML = options.multiline ?
        `<textarea spellcheck="false" class="b3-text-field fn__block" style="resize:${options.resize || "none"};${options.resize === "vertical" ? "min-height:28px;max-height:min(480px, 50vh)" : ""}" data-dialog-input></textarea>` :
        '<input spellcheck="false" class="b3-text-field fn__block" value="" data-dialog-input>';
    const actionsHTML = (position: "beforeCancel" | "beforeConfirm" | "afterConfirm") =>
        (options.actions || []).map((action, index) => (action.position || "beforeConfirm") === position ?
            `<button class="b3-button b3-button--touch b3-button--wrap b3-button--${action.danger ? "remove" : "text"}" data-input-action="${index}">${escapeHtml(action.text)}</button>` : "").filter(Boolean).join("");
    const actionHTML = [
        actionsHTML("beforeCancel"),
        `<button class="b3-button b3-button--touch b3-button--wrap b3-button--cancel b3-button--secondary" data-input-cancel>${window.siyuan.languages.cancel}</button>`,
        actionsHTML("beforeConfirm"),
        `<button class="b3-button b3-button--touch b3-button--wrap" data-input-confirm>${escapeHtml(options.confirmText || window.siyuan.languages.confirm)}</button>`,
        actionsHTML("afterConfirm"),
    ].filter(Boolean).join("");
    const dialog = new Dialog({
        title: options.title,
        mobileSheet: options.mobileSheet,
        positionId: options.positionId,
        content: `<div class="b3-dialog__content">${options.prefixContent || ""}${options.label ? `<label>${escapeHtml(options.label)}<div class="fn__hr"></div>${inputHTML}</label>` : inputHTML}${options.description ? `<div class="b3-label__text">${options.description}</div>` : ""}${options.extraContent || ""}</div>
<div class="b3-dialog__action mobile-sheet-action-bar">
    <div class="mobile-sheet-action-group${options.compactActions ? " mobile-sheet-action-group--compact" : options.actions?.length ? " mobile-sheet-action-group--stacked" : ""}">${actionHTML}</div>
</div>`,
        width: options.width || (isMobile() ? "92vw" : "520px"),
        destroyCallback: options.destroyCallback,
    });
    const inputElement = dialog.element.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-dialog-input]");
    const cancelElement = dialog.element.querySelector<HTMLButtonElement>("[data-input-cancel]");
    const confirmElement = dialog.element.querySelector<HTMLButtonElement>("[data-input-confirm]");
    if (inputElement instanceof HTMLInputElement) {
        if (options.type !== undefined) {
            inputElement.type = options.type;
        }
        if (options.min !== undefined) {
            inputElement.min = options.min;
        }
        if (options.max !== undefined) {
            inputElement.max = options.max;
        }
        if (options.step !== undefined) {
            inputElement.step = options.step;
        }
    }
    if (options.placeholder !== undefined) {
        inputElement.placeholder = options.placeholder;
    }
    inputElement.value = options.value;
    if (options.maxLength !== undefined) {
        inputElement.maxLength = options.maxLength;
    }
    cancelElement.addEventListener("click", () => {
        void dialog.requestClose("cancel");
    });
    confirmElement.addEventListener("click", () => {
        // 提交时将焦点交回输入框，校验未通过时可直接继续输入。
        if (options.awaitConfirm) {
            void dialog.runPending(async () => await options.onConfirm(inputElement.value, dialog) === true);
        } else {
            options.onConfirm(inputElement.value, dialog);
        }
    });
    dialog.element.querySelectorAll<HTMLButtonElement>("[data-input-action]").forEach(button => {
        button.addEventListener("click", () => {
            dialog.focusWhenReady(() => inputElement);
            options.actions[Number(button.dataset.inputAction)].onClick(inputElement.value, dialog);
        });
    });
    if (options.bindInput !== false) {
        dialog.bindInput(inputElement, () => {
            confirmElement.click();
        });
    }
    dialog.focusWhenReady(() => inputElement, {select: !options.multiline});
    return dialog;
};
