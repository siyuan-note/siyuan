import {showMessage} from "../dialog/message";
import {genUUID} from "../util/genID";

// 相同内容重试复用操作标识和时间，避免响应丢失后重复创建卡源或实体。
export const createFlashcardV2Operation = () => {
    let signature: string;
    let operation: {operationID: string, changedAt: number};
    return (payload: unknown) => {
        const nextSignature = JSON.stringify(payload);
        if (!operation || signature !== nextSignature) {
            signature = nextSignature;
            operation = {operationID: genUUID(), changedAt: Date.now()};
        }
        return operation;
    };
};

// 展开错误字段所在的高级选项，保留输入并把焦点移到需要修正的位置。
export const reportFlashcardV2Field = (element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
    let parent = element.parentElement;
    while (parent) {
        if (parent instanceof HTMLDetailsElement) {
            parent.open = true;
        }
        parent = parent.parentElement;
    }
    const label = element.closest(".b3-label")?.querySelector(".b3-label__text")?.textContent ||
        element.getAttribute("aria-label") || window.siyuan.languages.config;
    showMessage(window.siyuan.languages.flashcardInvalidField.replace("${field}", label), 6000, "error");
    element.focus();
    element.reportValidity();
    return false;
};

export const validateFlashcardV2Fields = (element: HTMLElement) => {
    for (const field of element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")) {
        if (!field.disabled && !field.closest(".fn__none") &&
            (!field.checkValidity() || field.required && !field.value.trim())) {
            return reportFlashcardV2Field(field);
        }
    }
    return true;
};

// 保存期间冻结表单；失败后恢复每个控件原有状态，避免重复提交或把已禁用的选项误启用。
export const submitFlashcardV2Form = async (element: HTMLElement, save: () => Promise<boolean>) => {
    if (element.getAttribute("aria-busy") === "true") {
        return;
    }
    const controls = [...element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement | HTMLTextAreaElement>(
        "input, select, button, textarea")];
    const disabled = controls.map((control) => control.disabled);
    element.setAttribute("aria-busy", "true");
    controls.forEach((control) => control.disabled = true);
    let saved = false;
    try {
        saved = await save();
    } catch (error) {
        console.error(error);
    } finally {
        // 保存成功后继续锁定控件，直到对话框完成关闭动画。
        if (!saved) {
            element.removeAttribute("aria-busy");
            controls.forEach((control, index) => control.disabled = disabled[index]);
            if (element.isConnected) {
                showMessage(window.siyuan.languages.flashcardSaveFailed, 6000, "error");
            }
        }
    }
};

// 多选使用可直接点击的复选框，与触屏和键盘保持相同的选择规则。
export const enhanceFlashcardV2MultiSelect = (select: HTMLSelectElement) => {
    const container = select.closest("label");
    if (container) {
        const group = document.createElement("div");
        for (const attribute of container.attributes) {
            group.setAttribute(attribute.name, attribute.value);
        }
        group.append(...container.childNodes);
        container.replaceWith(group);
    }
    const choices = document.createElement("div");
    choices.className = "card__v2-checklist";
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", select.closest(".b3-label")?.querySelector(".b3-label__text")?.textContent ||
        window.siyuan.languages.multiSelect);
    select.classList.add("fn__none");
    select.after(choices);
    const render = () => {
        choices.replaceChildren();
        for (const option of select.options) {
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = option.selected;
            checkbox.disabled = option.disabled || select.disabled;
            const text = document.createElement("span");
            text.textContent = option.textContent;
            label.append(checkbox, text);
            choices.append(label);
            checkbox.addEventListener("change", () => {
                option.selected = checkbox.checked;
                select.dispatchEvent(new Event("change", {bubbles: true}));
            });
        }
        if (select.options.length === 0) {
            choices.textContent = window.siyuan.languages.emptyContent;
        }
    };
    render();
    return render;
};
