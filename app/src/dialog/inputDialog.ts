import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {escapeHtml} from "../util/escape";

export const openInputDialog = (options: {
    title: string,
    value: string,
    label?: string,
    width?: string,
    maxLength?: number,
    type?: "text" | "number",
    min?: string,
    max?: string,
    step?: string,
    placeholder?: string,
    // 说明沿用现有本地化文案的 HTML 语义。
    description?: string,
    onConfirm: (value: string, dialog: Dialog) => void,
    destroyCallback?: (options?: IObject) => void,
}): Dialog => {
    const inputHTML = '<input spellcheck="false" class="b3-text-field fn__block" value="">';
    const dialog = new Dialog({
        title: options.title,
        content: `<div class="b3-dialog__content">${options.label ? `<label>${escapeHtml(options.label)}<div class="fn__hr"></div>${inputHTML}</label>` : inputHTML}${options.description ? `<div class="b3-label__text">${options.description}</div>` : ""}</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        width: options.width || (isMobile() ? "92vw" : "520px"),
        destroyCallback: options.destroyCallback,
    });
    const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
    const btnsElement = dialog.element.querySelectorAll<HTMLButtonElement>(".b3-button");
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
    if (options.placeholder !== undefined) {
        inputElement.placeholder = options.placeholder;
    }
    inputElement.value = options.value;
    if (options.maxLength !== undefined) {
        inputElement.maxLength = options.maxLength;
    }
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        // 校验、提交和关闭时机由调用方决定。
        options.onConfirm(inputElement.value, dialog);
    });
    dialog.bindInput(inputElement, () => {
        btnsElement[1].click();
    });
    inputElement.select();
    return dialog;
};
