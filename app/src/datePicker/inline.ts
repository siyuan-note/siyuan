import {createDateField} from "./field";
import {IDateConstraints, isDatePickerType, normalizeTimeDraft, validateDateValue} from "./model";

interface IInlineDateState {
    value: string;
    draft: string;
    valid: boolean;
    kind: "input" | "change" | "select" | "clear";
    part?: "date" | "time";
}

export const getInlineDateType = (input: HTMLInputElement) =>
    isDatePickerType(input.type) ? input.type : input.dataset.datePickerType;

const validationErrors = new WeakMap<HTMLInputElement, string>();
const composingInputs = new WeakSet<HTMLInputElement>();
const splitInputs = new WeakMap<HTMLInputElement, {time: HTMLInputElement; element: HTMLElement}>();
const getConstraints = (input: HTMLInputElement): IDateConstraints => {
    const type = getInlineDateType(input);
    if (!isDatePickerType(type)) { throw new TypeError("Invalid inline date input type"); }
    return {type, min: input.min, max: input.max, step: input.step, required: input.required,
        stepBase: input.getAttribute("value") || ""};
};
export const getInlineDateValue = (input: HTMLInputElement) => {
    if (getInlineDateType(input) !== "datetime-local") { return input.value; }
    const split = splitInputs.get(input);
    if (!split || /[T ]/.test(input.value)) { return input.value.replace(" ", "T"); }
    return input.value || split.time.value ? `${input.value}T${normalizeTimeDraft(split.time.value)}` : "";
};
export const setInlineDateValue = (input: HTMLInputElement, value: string) => {
    const type = getInlineDateType(input);
    const normalized = type === "datetime-local" ? value.replace(" ", "T") : value;
    const split = splitInputs.get(input);
    if (split && type === "datetime-local") {
        const separator = normalized.indexOf("T");
        const date = separator < 0 ? normalized : normalized.substring(0, separator);
        const time = separator < 0 ? "" : normalized.substring(separator + 1);
        for (const [target, draft] of [[input, date], [split.time, time]] as const) {
            if (target.value === draft) { continue; }
            const selection = target.ownerDocument.activeElement === target ?
                [target.selectionStart, target.selectionEnd, target.selectionDirection] as const : undefined;
            target.value = draft;
            if (selection) { target.setSelectionRange(...selection); }
        }
        return;
    }
    const display = type === "datetime-local" && validateDateValue(normalized, {type, step: "any"}) === "valid" ?
        normalized.replace("T", " ") : value;
    if (input.value === display) { return; }
    const selection = input.type === "text" && input.ownerDocument.activeElement === input ?
        [input.selectionStart, input.selectionEnd, input.selectionDirection] as const : undefined;
    input.value = display;
    if (selection) { input.setSelectionRange(...selection); }
};
export const validateInlineDateInput = (input: HTMLInputElement, message = input.ownerDocument.defaultView.siyuan?.languages.invalid || "Invalid") => {
    const rules = getConstraints(input);
    const probe = input.ownerDocument.createElement("input");
    probe.type = rules.type;
    probe.min = rules.min;
    probe.max = rules.max;
    probe.step = rules.step;
    probe.required = rules.required;
    probe.setAttribute("value", rules.stepBase);
    const value = getInlineDateValue(input);
    probe.value = value;
    const valid = !composingInputs.has(input) && validateDateValue(value, rules) === "valid" && (!value || !!probe.value) && probe.validity.valid;
    const error = valid ? "" : probe.validationMessage || message;
    validationErrors.set(input, error);
    input.setCustomValidity(error);
    input.setAttribute("aria-invalid", String(!valid));
    const time = splitInputs.get(input)?.time;
    if (time) {
        time.setCustomValidity(error);
        time.setAttribute("aria-invalid", String(!valid));
    }
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
    const editingParts = new WeakMap<HTMLInputElement, "date" | "time">();
    const restoreTypes = new Map<HTMLInputElement, string>();
    const splitReleases = new Map<HTMLInputElement, () => void>();
    let active: HTMLInputElement;
    let field: ReturnType<typeof createDateField>;
    let renderedValue: string;
    let disposed = false;
    let writing = false;
    let observedState: string;
    const available = (input: HTMLInputElement) => input.isConnected && input.ownerDocument === doc && !input.matches(":disabled") &&
        !input.readOnly && isDatePickerType(getInlineDateType(input)) && !input.closest(".fn__none, [hidden]");
    const inputState = () => JSON.stringify(inputs.map(input => [input.type, getInlineDateType(input), input.min,
        input.max, input.step, input.getAttribute("value"), input.required, input.disabled, input.readOnly, input.hidden,
        input.classList.contains("fn__none"), available(input)]));
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
        let valid = field.validate();
        if (valid) {
            let value = field.commit();
            if (value !== undefined) {
                const split = splitInputs.get(input);
                if (split && kind === "select") { value = `${value.split("T")[0]}T${split.time.value}`; }
                writing = true;
                const changed = getInlineDateValue(input) !== value;
                setInlineDateValue(input, value);
                valid = validateInput(input);
                if (changed) { input.dispatchEvent(new view.Event("input", {bubbles: true})); }
                if (!disposed && (changed || kind === "select" || kind === "clear") && kind !== "input") {
                    input.dispatchEvent(new view.Event("change", {bubbles: true}));
                }
                writing = false;
            }
        }
        if (!disposed) { options.onChange?.(input, {value: getInlineDateValue(input), draft, valid, kind}); }
    };
    const render = () => {
        field?.destroy();
        field = undefined;
        inputs.forEach(input => { input.dataset.datePickerActive = String(input === active); });
        if (!active || disposed || getInlineDateType(active) === "time") { return; }
        renderedValue = getInlineDateValue(active);
        field = createDateField(host, {...getConstraints(active), value: renderedValue,
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
            getInlineDateType(input) === "time" ? "HH:mm[:ss[.SSS]]" : "YYYY-MM-DD HH:mm";
        if (getInlineDateType(input) !== "datetime-local") {
            splitReleases.get(input)?.();
            return;
        }
        if (!splitInputs.has(input)) {
            const value = input.value;
            const inputLabel = input.getAttribute("aria-label") || Array.from(input.labels || [])
                .map(label => label.textContent.trim()).filter(Boolean).join(" ");
            const element = doc.createElement("span");
            element.className = "date-picker__split";
            const dateField = doc.createElement("span");
            dateField.className = "date-picker__split-date";
            const dateLabel = doc.createElement("span");
            dateLabel.className = "ft__smaller";
            dateLabel.textContent = languages.date || languages.startDate;
            if (!input.getAttribute("aria-label") && !input.labels?.length) { input.setAttribute("aria-label", dateLabel.textContent); }
            const timeField = doc.createElement("span");
            timeField.className = "date-picker__split-time";
            const timeLabel = doc.createElement("span");
            timeLabel.className = "ft__smaller";
            timeLabel.textContent = languages.datePickerTime || languages.includeTime;
            const time = doc.createElement("input");
            time.type = "text";
            time.className = "b3-text-field date-picker-input";
            time.dataset.datePickerPart = "time";
            time.placeholder = "HH:mm";
            time.autocomplete = "off";
            time.spellcheck = false;
            time.setAttribute("aria-label", inputLabel.endsWith(timeLabel.textContent) ? inputLabel :
                `${inputLabel} ${timeLabel.textContent}`.trim());
            input.before(element);
            dateField.append(input);
            timeField.append(time);
            element.append(dateField, timeField);
            splitInputs.set(input, {time, element});
            setInlineDateValue(input, value);
            const reportDescriptor = Object.getOwnPropertyDescriptor(input, "reportValidity");
            const reportValidity = input.reportValidity.bind(input);
            Object.defineProperty(input, "reportValidity", {configurable: true, value: () =>
                validateDateValue(input.value, {type: "date"}) === "valid" && input.value && !time.validity.valid ?
                    time.reportValidity() : reportValidity()});
            let forwarding = false;
            let changed = false;
            const forward = (name: string) => {
                forwarding = true;
                try { input.dispatchEvent(new view.Event(name, {bubbles: true})); }
                finally { forwarding = false; }
            };
            const onInput = (event: Event) => {
                if (forwarding || writing) { return; }
                changed = true;
                const target = event.target as HTMLInputElement;
                editingParts.set(input, target === time || /[T ]/.test(target.value) ? "time" : "date");
                if (!composing.has(input) && /[T ]/.test(target.value)) {
                    const full = target.value.replace(" ", "T");
                    if (validateDateValue(full, {type: "datetime-local", step: "any"}) === "valid") {
                        setInlineDateValue(input, full);
                    }
                }
                if (target === time) {
                    event.stopImmediatePropagation();
                    forward("input");
                }
            };
            const onChange = (event: Event) => {
                if (forwarding || writing) { return; }
                if (event.isTrusted) { event.stopImmediatePropagation(); }
                else { onInput(event); }
            };
            const onBlur = (event: FocusEvent) => {
                event.stopImmediatePropagation();
            };
            const onLeave = (event: FocusEvent) => {
                if (element.contains(event.relatedTarget as Node) || !changed) { return; }
                if (!composing.has(input)) { time.value = normalizeTimeDraft(time.value); }
                changed = false;
                forward("change");
            };
            const onFocus = () => activate(input);
            const onKey = (event: KeyboardEvent) => {
                event.stopPropagation();
                if (event.key === "Tab") { return; }
                const forwarded = new view.KeyboardEvent("keydown", {key: event.key, code: event.code,
                    altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
                    metaKey: event.metaKey, isComposing: event.isComposing, bubbles: true, cancelable: true});
                if (!input.dispatchEvent(forwarded)) { event.preventDefault(); }
            };
            const onComposition = (event: CompositionEvent) => {
                event.stopPropagation();
                input.dispatchEvent(new view.CompositionEvent(event.type, {data: event.data, bubbles: true}));
            };
            element.addEventListener("input", onInput, true);
            element.addEventListener("change", onChange, true);
            element.addEventListener("blur", onBlur, true);
            element.addEventListener("focusout", onLeave);
            time.addEventListener("focus", onFocus);
            time.addEventListener("keydown", onKey);
            time.addEventListener("compositionstart", onComposition);
            time.addEventListener("compositionend", onComposition);
            splitReleases.set(input, () => {
                const value = getInlineDateValue(input);
                if (input.parentElement === dateField) { element.replaceWith(input); }
                else { element.remove(); }
                splitInputs.delete(input);
                splitReleases.delete(input);
                input.value = value;
                if (reportDescriptor) { Object.defineProperty(input, "reportValidity", reportDescriptor); }
                else { delete input.reportValidity; }
            });
        }
        input.placeholder = "YYYY-MM-DD";
        const split = splitInputs.get(input);
        split.time.disabled = input.disabled;
        split.time.readOnly = input.readOnly;
        split.element.classList.toggle("fn__none", input.classList.contains("fn__none") || !!input.hidden);
    };
    const update = () => {
        if (disposed) { return; }
        inputs.forEach(input => {
            syncType(input);
            if (!composing.has(input) && (!splitInputs.has(input) || /[T ]/.test(input.value))) {
                setInlineDateValue(input, getInlineDateValue(input));
            }
            validateInput(input);
        });
        if (active && !available(active)) { active = inputs.find(available); }
        observedState = inputState();
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
        const open = () => {
            activate(input);
            if (getInlineDateType(input) === "time") { input.focus(); return; }
            const current = field;
            current?.focus();
            if (field !== current) { field?.focus(); }
        };
        const focus = () => activate(input);
        const key = (event: KeyboardEvent) => {
            if (event.isComposing || event.keyCode === 229 || composing.has(input)) {
                if (event.key === "Enter" || event.key === "Escape") { event.stopPropagation(); }
                return;
            }
            if (event.key === "Enter") {
                const time = splitInputs.get(input)?.time;
                if (time) { time.value = normalizeTimeDraft(time.value); }
                validateInput(input);
            }
            if (event.key === " " && getInlineDateType(input) !== "datetime-local" || event.altKey && event.key === "ArrowDown") {
                event.preventDefault(); event.stopPropagation(); open();
            }
        };
        const change = (event: Event) => {
            if (writing || disposed) { return; }
            const valid = validateInput(input);
            if (active === input && !composing.has(input) &&
                (!field || event.type !== "change" || getInlineDateValue(input) !== renderedValue)) { render(); }
            const part = editingParts.get(input);
            editingParts.delete(input);
            options.onChange?.(input, {value: getInlineDateValue(input), draft: input.value, valid,
                kind: event.type === "change" ? "change" : "input", part});
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
            splitReleases.get(input)?.();
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
            inputs.some(input => record.target === input || (record.target as Element).contains(input)))) {
            // 菜单分组、标题等样式变化不改变输入语义，不能因此重建日历。
            if (inputState() !== observedState) { update(); }
        }
    });
    observer.observe(doc.documentElement, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["data-dialog-closing", "disabled", "readonly", "type", "min", "max", "step", "required", "class", "hidden"]});
    view.addEventListener("pagehide", destroy, {once: true});
    update();
    if (inputs.includes(doc.activeElement as HTMLInputElement)) { activate(doc.activeElement as HTMLInputElement); }
    return {activate, update, destroy,
        isActive: (input?: HTMLInputElement) => !disposed && (!input || active === input) &&
            (doc.activeElement === active || !!splitInputs.get(active)?.element.contains(doc.activeElement) ||
                !!field?.element.contains(doc.activeElement)),
        validate: () => !disposed && !inputs.some(input => available(input) && !validateInput(input)) &&
            (!field || !field.isComposing()),
    };
};
