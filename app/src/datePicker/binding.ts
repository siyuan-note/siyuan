import {IDatePickerHandle, openInternalDatePicker, TDatePickerResult} from "./index";
import {isDatePickerType} from "./model";

interface IDatePickerBindingOptions {
    onCommit?: (value: string) => void;
    onClose?: (result: TDatePickerResult) => void;
}
const bindings = new WeakMap<HTMLInputElement, {open(): void; destroy(): void; isOpen(): boolean}>();
const documents = new WeakMap<Document, {checks: Set<() => void>; dispose(): void}>();
const watchDocument = (doc: Document, check: () => void) => {
    let state = documents.get(doc);
    if (!state) {
        const checks = new Set<() => void>();
        const run = () => Array.from(checks).forEach(callback => callback());
        const observer = new doc.defaultView.MutationObserver(run);
        observer.observe(doc.documentElement, {childList: true, subtree: true, attributes: true,
            attributeFilter: ["data-dialog-closing", "disabled", "readonly", "type", "class", "hidden", "style"]});
        state = {checks, dispose: () => {
            observer.disconnect();
            documents.delete(doc);
        }};
        documents.set(doc, state);
    }
    state.checks.add(check);
    return () => {
        state.checks.delete(check);
        if (!state.checks.size) { state.dispose(); }
    };
};
export const isDatePickerOpen = (input: HTMLInputElement) => bindings.get(input)?.isOpen() || false;
export const bindDatePicker = (input: HTMLInputElement, options: IDatePickerBindingOptions = {}) => {
    const bound = bindings.get(input);
    if (bound) { return bound; }
    const doc = input.ownerDocument;
    const view = doc.defaultView;
    let disposed = false;
    let opening = false;
    let picker: IDatePickerHandle;
    let openType: string;
    const previousShowPicker = Object.getOwnPropertyDescriptor(input, "showPicker");
    const previousPopup = input.getAttribute("aria-haspopup");
    const previousExpanded = input.getAttribute("aria-expanded");
    const hadClass = input.classList.contains("date-picker-input");
    const restore = (name: string, value: string) => {
        if (value === null) { input.removeAttribute(name); } else { input.setAttribute(name, value); }
    };
    const safe = (callback: () => void) => {
        try { callback(); } catch (error) { console.error("Date picker binding callback failed", error); }
    };
    const open = () => {
        if (disposed || opening || picker || !input.isConnected || input.matches(":disabled") || input.readOnly || !isDatePickerType(input.type)) { return; }
        opening = true;
        input.setAttribute("aria-expanded", "true");
        const type = input.type;
        openType = type;
        const baseline = input.value;
        try {
            input.focus({preventScroll: true});
            picker = openInternalDatePicker({ownerElement: input, type, value: baseline,
                min: input.min, max: input.max, step: input.step, required: input.required,
                stepBase: input.getAttribute("value") || "", initialBadInput: input.validity.badInput,
                autoConfirm: true,
            });
        } catch (error) {
            opening = false;
            input.setAttribute("aria-expanded", "false");
            throw error;
        }
        opening = false;
        const session = picker;
        void session.result.then(result => {
            if (picker !== session) { return; }
            picker = undefined;
            input.setAttribute("aria-expanded", "false");
            if (!disposed && input.isConnected && input.ownerDocument === doc) {
                if (result.type === "confirm" && input.type === type && !input.matches(":disabled") && !input.readOnly && input.value === baseline) {
                    const validator = doc.createElement("input");
                    validator.type = type;
                    validator.min = input.min;
                    validator.max = input.max;
                    validator.step = input.step;
                    validator.required = input.required;
                    validator.setAttribute("value", input.getAttribute("value") || "");
                    validator.value = result.value;
                    if (validator.value === result.value && validator.validity.valid) {
                        if (input.value !== result.value || input.validity.badInput) {
                            input.value = result.value;
                            input.dispatchEvent(new view.Event("input", {bubbles: true}));
                            if (!disposed && input.isConnected) { input.dispatchEvent(new view.Event("change", {bubbles: true})); }
                        }
                        if (!disposed && input.isConnected) { safe(() => options.onCommit?.(input.value)); }
                    }
                }
                safe(() => options.onClose?.(result));
            }
        });
    };
    const pointer = (event: PointerEvent) => {
        if (event.button !== 0 || input.disabled || input.readOnly || !isDatePickerType(input.type)) { return; }
        event.preventDefault();
        // Touch and pen must open after release so the resulting click cannot dismiss the new overlay.
        if (event.pointerType !== "touch" && event.pointerType !== "pen") { open(); }
    };
    const click = (event: MouseEvent) => {
        if (!isDatePickerType(input.type) || input.disabled || input.readOnly) { return; }
        event.preventDefault();
        open();
    };
    const key = (event: KeyboardEvent) => {
        if (!isDatePickerType(input.type) || input.matches(":disabled") || input.readOnly || event.isComposing || event.keyCode === 229 ||
            event.repeat || (event.key !== " " && !(event.altKey && event.key === "ArrowDown"))) { return; }
        event.preventDefault(); event.stopPropagation(); open();
    };
    const destroy = () => {
        if (disposed) { return; }
        disposed = true;
        unwatch();
        view.removeEventListener("pagehide", destroy);
        input.removeEventListener("pointerdown", pointer);
        input.removeEventListener("click", click);
        input.removeEventListener("keydown", key);
        picker?.destroy();
        picker = undefined;
        if (!hadClass) { input.classList.remove("date-picker-input"); }
        restore("aria-haspopup", previousPopup);
        restore("aria-expanded", previousExpanded);
        if (input.showPicker === open) {
            if (previousShowPicker) { Object.defineProperty(input, "showPicker", previousShowPicker); }
            else { delete input.showPicker; }
        }
        bindings.delete(input);
    };
    const unwatch = watchDocument(doc, () => {
        if (!input.isConnected || input.ownerDocument !== doc || input.closest('[data-dialog-closing="true"]')) { destroy(); }
        else if (picker && (input.matches(":disabled") || input.readOnly || input.type !== openType || input.closest(".fn__none, [hidden]") ||
            !input.getClientRects().length)) {
            picker.destroy();
        }
    });
    const handle = {open, destroy, isOpen: () => opening || !!picker};
    bindings.set(input, handle);
    input.classList.add("date-picker-input");
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "false");
    Object.defineProperty(input, "showPicker", {configurable: true, writable: true, value: open});
    input.addEventListener("pointerdown", pointer);
    input.addEventListener("click", click);
    input.addEventListener("keydown", key);
    view.addEventListener("pagehide", destroy, {once: true});
    return handle;
};
