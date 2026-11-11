import {createDateField} from "./field";
import {IDateConstraints, isDatePickerType, validateDateValue} from "./model";

interface IInlineDateState {
    value: string;
    draft: string;
    valid: boolean;
    kind: "input" | "change" | "select" | "clear";
}

export const getInlineDateType = (input: HTMLInputElement) =>
    isDatePickerType(input.type) ? input.type : input.dataset.datePickerType;

const validationErrors = new WeakMap<HTMLInputElement, string>();
const composingInputs = new WeakSet<HTMLInputElement>();
const getConstraints = (input: HTMLInputElement): IDateConstraints => {
    const type = getInlineDateType(input);
    if (!isDatePickerType(type)) { throw new TypeError("Invalid inline date input type"); }
    return {type, min: input.min, max: input.max, step: input.step, required: input.required,
        stepBase: input.getAttribute("value") || ""};
};
const valueOf = (input: HTMLInputElement) => getInlineDateType(input) === "datetime-local" ? input.value.replace(" ", "T") : input.value;
export const validateInlineDateInput = (input: HTMLInputElement, message = input.ownerDocument.defaultView.siyuan?.languages.invalid || "Invalid") => {
    const rules = getConstraints(input);
    const probe = input.ownerDocument.createElement("input");
    probe.type = rules.type;
    probe.min = rules.min;
    probe.max = rules.max;
    probe.step = rules.step;
    probe.required = rules.required;
    probe.setAttribute("value", rules.stepBase);
    const value = valueOf(input);
    probe.value = value;
    const valid = !composingInputs.has(input) && validateDateValue(value, rules) === "valid" && (!value || !!probe.value) && probe.validity.valid;
    const error = valid ? "" : probe.validationMessage || message;
    validationErrors.set(input, error);
    input.setCustomValidity(error);
    input.setAttribute("aria-invalid", String(!valid));
    return valid;
};

export const bindInlineDatePicker = (host: HTMLElement, source: HTMLInputElement | HTMLInputElement[], options: {
    languages?: Record<string, string>;
    onChange?: (input: HTMLInputElement, state: IInlineDateState) => void;
} = {}) => {
    const inputs = Array.isArray(source) ? source : [source];
    const doc = host.ownerDocument;
    const view = doc.defaultView;
    const languages = options.languages || view.siyuan.languages;
    const releases: (() => void)[] = [];
    const composing = new Set<HTMLInputElement>();
    const restoreTypes = new Map<HTMLInputElement, string>();
    let active: HTMLInputElement;
    let field: ReturnType<typeof createDateField>;
    let disposed = false;
    let writing = false;
    const available = (input: HTMLInputElement) => input.isConnected && input.ownerDocument === doc && !input.matches(":disabled") &&
        !input.readOnly && isDatePickerType(getInlineDateType(input)) && !input.closest(".fn__none, [hidden]");
    const validateInput = (input: HTMLInputElement) => {
        if (composing.has(input)) {
            validationErrors.set(input, languages.invalid);
            input.setCustomValidity(languages.invalid);
            input.setAttribute("aria-invalid", "true");
            return false;
        }
        return validateInlineDateInput(input, languages.invalid);
    };
    const emit = (kind: IInlineDateState["kind"]) => {
        if (disposed || !field || !available(active) || composing.size) { return; }
        const input = active;
        const draft = field.draft();
        const valid = field.validate();
        if (valid) {
            const value = field.commit();
            if (value !== undefined) {
                writing = true;
                const changed = input.value !== value;
                input.value = value;
                validateInput(input);
                if (changed) { input.dispatchEvent(new view.Event("input", {bubbles: true})); }
                if (!disposed && (changed || kind === "select" || kind === "clear") && kind !== "input") {
                    input.dispatchEvent(new view.Event("change", {bubbles: true}));
                }
                writing = false;
            }
        }
        if (!disposed) { options.onChange?.(input, {value: input.value, draft, valid, kind}); }
    };
    const render = () => {
        field?.destroy();
        field = undefined;
        inputs.forEach(input => { input.dataset.datePickerActive = String(input === active); });
        if (!active || disposed || getInlineDateType(active) === "time") { return; }
        field = createDateField(host, {...getConstraints(active), value: valueOf(active),
            languages, hideFields: true, hideClear: true, onChange: emit});
        field.element.classList.add("date-picker--inline");
        if (inputs.length > 1) {
            const status = doc.createElement("div");
            status.className = "ft__smaller ft__primary";
            status.setAttribute("role", "status");
            status.textContent = active.getAttribute("aria-label") ||
                (inputs.indexOf(active) === 0 ? languages.startDate : languages.endDate);
            field.element.prepend(status);
        }
        ["pointerdown", "mousedown", "click", "dblclick", "input", "change"].forEach(name => {
            field.element.addEventListener(name, event => event.stopPropagation());
        });
        field.element.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                if (event.isComposing || event.keyCode === 229 || field.isComposing() || composing.size) { event.stopPropagation(); return; }
                if (field.cancelMonthEdit()) { event.preventDefault(); event.stopPropagation(); }
                return;
            }
            event.stopPropagation();
        });
    };
    const activate = (input: HTMLInputElement) => {
        if (disposed || !inputs.includes(input) || !available(input) || active === input) { return; }
        active = input;
        render();
    };
    const syncType = (input: HTMLInputElement) => {
        // 文本输入允许原位编辑；日期约束由原生探针验证，移动端聚焦不会打开系统选择器。
        if (isDatePickerType(input.type)) {
            restoreTypes.set(input, input.type);
            input.dataset.datePickerType = input.type;
            const value = input.value;
            input.type = "text";
            input.value = value;
        }
        input.placeholder = getInlineDateType(input) === "date" ? "YYYY-MM-DD" :
            getInlineDateType(input) === "time" ? "HH:mm[:ss[.SSS]]" : "YYYY-MM-DDTHH:mm[:ss[.SSS]]";
    };
    const update = () => {
        if (disposed) { return; }
        inputs.forEach(input => { syncType(input); validateInput(input); });
        if (active && !available(active)) { active = inputs.find(available); }
        render();
    };
    const destroy = () => {
        if (disposed) { return; }
        disposed = true;
        observer.disconnect();
        field?.destroy();
        releases.forEach(release => release());
        view.removeEventListener("pagehide", destroy);
    };
    inputs.forEach(input => {
        restoreTypes.set(input, input.type);
        const hadClass = input.classList.contains("date-picker-input");
        const descriptor = Object.getOwnPropertyDescriptor(input, "showPicker");
        const attributes = ["placeholder", "aria-invalid", "data-date-picker-type", "data-date-picker-active", "aria-label", "autocomplete", "spellcheck"].map(name => [name, input.getAttribute(name)]);
        if (inputs.length > 1 && !input.getAttribute("aria-label") && !input.labels?.length) {
            input.setAttribute("aria-label", inputs.indexOf(input) === 0 ? languages.startDate : languages.endDate);
        }
        const oldError = input.validity.customError && validationErrors.get(input) !== input.validationMessage ? input.validationMessage : "";
        const open = () => { activate(input); if (getInlineDateType(input) === "time") { input.focus(); } else { field?.focus(); } };
        const focus = () => activate(input);
        const key = (event: KeyboardEvent) => {
            if (event.isComposing || event.keyCode === 229 || composing.has(input)) {
                if (event.key === "Enter" || event.key === "Escape") { event.stopPropagation(); }
                return;
            }
            if (event.key === " " || event.altKey && event.key === "ArrowDown") {
                event.preventDefault(); event.stopPropagation(); open();
            }
        };
        const change = (event: Event) => {
            if (writing || disposed) { return; }
            const valid = validateInput(input);
            if (active === input && !composing.has(input)) { render(); }
            options.onChange?.(input, {value: input.value, draft: input.value, valid, kind: event.type === "change" ? "change" : "input"});
        };
        const startComposition = () => { composing.add(input); composingInputs.add(input); validateInput(input); };
        const endComposition = () => { composing.delete(input); composingInputs.delete(input); change(new view.Event("input")); };
        input.classList.add("date-picker-input");
        input.autocomplete = "off";
        input.spellcheck = false;
        Object.defineProperty(input, "showPicker", {configurable: true, writable: true, value: open});
        input.addEventListener("focus", focus);
        input.addEventListener("keydown", key, true);
        input.addEventListener("input", change, true);
        input.addEventListener("change", change, true);
        input.addEventListener("compositionstart", startComposition);
        input.addEventListener("compositionend", endComposition);
        releases.push(() => {
            input.removeEventListener("focus", focus);
            input.removeEventListener("keydown", key, true);
            input.removeEventListener("input", change, true);
            input.removeEventListener("change", change, true);
            input.removeEventListener("compositionstart", startComposition);
            input.removeEventListener("compositionend", endComposition);
            if (!hadClass) { input.classList.remove("date-picker-input"); }
            const type = getInlineDateType(input);
            const draft = input.value;
            const valid = validateInput(input);
            if (valid) { input.type = restoreTypes.get(input); }
            // 原生类型会清空不完整文本或规范化精度，销毁时必须保留宿主尚未提交的草稿。
            const preserveDraft = !valid || input.value !== draft;
            if (preserveDraft) { input.type = "text"; input.value = draft; }
            if (valid) { input.setCustomValidity(oldError); }
            attributes.forEach(([name, value]) => { if (value === null) { input.removeAttribute(name); } else { input.setAttribute(name, value); } });
            if (preserveDraft) {
                input.dataset.datePickerType = type;
                input.setAttribute("aria-invalid", String(!valid));
            }
            composingInputs.delete(input);
            if (input.showPicker === open) {
                if (descriptor) { Object.defineProperty(input, "showPicker", descriptor); }
                else { delete input.showPicker; }
            }
        });
    });
    const observer = new view.MutationObserver(records => {
        if (!host.isConnected || host.ownerDocument !== doc || host.closest('[data-dialog-closing="true"]') ||
            inputs.every(input => !input.isConnected || input.ownerDocument !== doc)) { destroy(); return; }
        if (active && !available(active) || records.some(record => record.type === "attributes" &&
            inputs.some(input => record.target === input || (record.target as Element).contains(input)))) { update(); }
    });
    observer.observe(doc.documentElement, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-dialog-closing", "disabled", "readonly", "type", "min", "max", "step", "required", "class", "hidden"]});
    view.addEventListener("pagehide", destroy, {once: true});
    update();
    if (inputs.includes(doc.activeElement as HTMLInputElement)) { activate(doc.activeElement as HTMLInputElement); }
    return {activate, update, destroy,
        isActive: (input?: HTMLInputElement) => !disposed && (!input || active === input) &&
            (doc.activeElement === active || !!field?.element.contains(doc.activeElement)),
        validate: () => !disposed && !inputs.some(input => available(input) && !validateInput(input)) &&
            (!field || !field.isComposing()),
    };
};
