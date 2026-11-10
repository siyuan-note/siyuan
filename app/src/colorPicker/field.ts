import {ColorSession} from "./session";
import {IColorValue, parseColor, parseRGBText, TColorInput} from "./model";
import {createNativeColorInput} from "./native";

export type TColorFieldState = "valid" | "invalid" | "composing";
export type TColorDraft = {ok: true; value: IColorValue; changed: boolean} |
    {ok: false; state: "invalid" | "composing"};

export const createColorField = (host: HTMLElement, options: {
    value: TColorInput;
    label: string;
    languages: Record<string, string>;
    onPreview?: (value: IColorValue) => void;
    onStateChange?: () => void;
}) => {
    const doc = host.ownerDocument;
    const lang = options.languages;
    let session = new ColorSession(options.value);
    let disposed = false;
    let disabled = false;
    let invalid = false;
    let lastSource: HTMLInputElement;
    let native: ReturnType<typeof createNativeColorInput>;
    const composing = new Set<HTMLInputElement>();
    const root = doc.createElement("div");
    root.className = "color-picker";
    const preview = doc.createElement("div");
    preview.className = "color-picker__preview";
    const makeSwatch = (label: string) => {
        const group = doc.createElement("span");
        const text = doc.createElement("span");
        text.textContent = label;
        const swatch = doc.createElement("span");
        swatch.className = "color-picker__swatch";
        group.append(text, swatch);
        preview.append(group);
        return swatch;
    };
    const original = makeSwatch(lang.originalValue);
    const draft = makeSwatch(lang.new);
    const controls = doc.createElement("div");
    controls.className = "color-picker__fields";
    const makeInput = (label: string) => {
        const wrapper = doc.createElement("label");
        wrapper.className = "color-picker__field" + (label === "HEX" ? " color-picker__field--hex" : "");
        const text = doc.createElement("span");
        text.textContent = label;
        const input = doc.createElement("input");
        input.type = "text";
        input.spellcheck = false;
        input.className = "b3-text-field b3-text-field--touch";
        input.setAttribute("aria-label", `${options.label} ${label}`);
        wrapper.append(text, input);
        controls.append(wrapper);
        return input;
    };
    const hex = makeInput("HEX");
    const rgb = ["R", "G", "B"].map(makeInput);
    rgb.forEach(input => input.inputMode = "numeric");
    const error = doc.createElement("div");
    error.className = "ft__error";
    error.setAttribute("role", "status");
    error.id = "color-picker-error-" + Math.random().toString(36).substring(2);
    [hex, ...rgb].forEach(input => input.setAttribute("aria-describedby", error.id));
    root.append(preview, controls, error);
    host.append(root);
    const validate = (): TColorFieldState => disposed ? "invalid" : disabled ? "valid" : composing.size ? "composing" : invalid ? "invalid" : "valid";
    const notify = () => options.onStateChange?.();
    const showError = (message = "") => {
        error.textContent = message || (native && !native.supported ? lang.nativeColorUnavailable : "");
        [hex, ...rgb].forEach(input => input.setAttribute("aria-invalid", String(invalid)));
    };
    const sync = (value: IColorValue, source?: HTMLInputElement) => {
        if (source !== hex && !composing.has(hex)) { hex.value = value.hex; }
        rgb.forEach((input, index) => {
            if (input !== source && !composing.has(input)) { input.value = String(value.rgb[(["r", "g", "b"] as const)[index]]); }
        });
        draft.style.backgroundColor = value.hex;
        native?.setValue(value);
    };
    const accept = (value: IColorValue | undefined, source?: HTMLInputElement) => {
        if (disposed || disabled || !root.isConnected || root.ownerDocument !== doc || root.closest('[data-dialog-closing="true"]')) { return; }
        invalid = !value;
        showError(invalid ? lang.invalidColor : "");
        if (value) {
            const changed = session.update(value.hex);
            sync(value, source);
            if (changed) { options.onPreview?.(session.value); }
        }
        notify();
    };
    const read = (input: HTMLInputElement) => {
        lastSource = input;
        accept(input === hex ? parseColor(hex.value) : parseRGBText(rgb.map(item => item.value)), input);
    };
    const bind = (input: HTMLInputElement) => {
        input.addEventListener("compositionstart", () => { if (!disposed && !disabled) { composing.add(input); notify(); } });
        input.addEventListener("compositionend", () => { composing.delete(input); read(input); });
        input.addEventListener("input", () => { if (!composing.has(input)) { read(input); } });
        input.addEventListener("blur", () => {
            if (!disposed && !composing.has(input) && !invalid) { sync(session.value); }
        });
    };
    [hex, ...rgb].forEach(bind);
    const setValue = (value: TColorInput) => {
        if (disposed) { return; }
        const parsed = parseColor(value);
        if (!parsed) { throw new TypeError("Invalid sRGB color"); }
        native?.destroy();
        native?.element.remove();
        session.finish("replaced");
        session = new ColorSession(parsed.hex);
        composing.clear();
        invalid = false;
        native = createNativeColorInput(doc, parsed, options.label, value => {
            if (!composing.size) { accept(value); }
        }, () => invalid || hex.value !== session.value.hex || rgb.some((input, index) =>
            input.value !== String(session.value.rgb[(["r", "g", "b"] as const)[index]])));
        native.element.disabled = disabled;
        preview.append(native.element);
        original.style.backgroundColor = parsed.hex;
        sync(parsed);
        showError();
        notify();
    };
    setValue(options.value);
    const destroy = () => {
        if (disposed) { return; }
        disposed = true;
        observer.disconnect();
        native.destroy();
        session.finish("destroy");
        root.remove();
    };
    const observer = new doc.defaultView.MutationObserver(() => {
        if (!root.isConnected || root.ownerDocument !== doc || root.closest('[data-dialog-closing="true"]')) { destroy(); }
    });
    observer.observe(doc.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ["data-dialog-closing"]});
    return {
        element: root,
        getValue: () => session.value,
        setValue,
        validate,
        commitDraft: (): TColorDraft => {
            const state = validate();
            if (state !== "valid") { showError(state === "composing" ? lang.colorPickerComposing : lang.invalidColor); return {ok: false, state}; }
            sync(session.value);
            return {ok: true, value: session.value, changed: session.value.hex !== session.baseline.hex};
        },
        focusError: () => { if (!disabled) { (Array.from(composing)[0] || lastSource || hex).focus(); } },
        setEnabled: (enabled: boolean) => {
            disabled = !enabled;
            [hex, ...rgb, native.element].forEach(input => input.disabled = disabled);
            if (disabled) { composing.clear(); }
            notify();
        },
        destroy,
    };
};
