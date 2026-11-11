import type {Plugin} from "../plugin";
import {createDateField} from "./field";
import {IDateConstraints, isDatePickerType, valueToNumber} from "./model";
import {getDatePickerOwner} from "./owners";
import {registerDatePickerWindow} from "./panel";
import {getDatePickerRuntime} from "./runtime";
import {getMenuOwnerElement, registerMenuOverlay} from "../menus/overlayOwnership";

export type TDatePickerCancelReason = "cancel" | "escape" | "dismiss" | "destroy" | "replaced" | "owner-destroyed";
export type TDatePickerResult = {type: "confirm"; value: string; changed: boolean} |
    {type: "cancel"; reason: TDatePickerCancelReason};
export interface IDatePickerOptions extends Omit<IDateConstraints, "stepBase"> {
    value?: string;
    title?: string;
    locale?: string;
    ownerPlugin: Plugin;
    ownerElement: HTMLElement;
}
export interface IDatePickerHandle {
    result: Promise<TDatePickerResult>;
    destroy(): void;
}
export const openDatePicker = (options: IDatePickerOptions): IDatePickerHandle => {
    const owner = getDatePickerOwner(options?.ownerPlugin);
    return openInternalDatePicker(options, {sessions: owner.sessions, isActive: () => owner.active});
};
export const openInternalDatePicker = (options: Omit<IDatePickerOptions, "ownerPlugin"> & {
    stepBase?: string;
    initialBadInput?: boolean;
    autoConfirm?: boolean;
}, owner?: {sessions: Set<() => void>; isActive: () => boolean}): IDatePickerHandle => {
    const initial = options?.value ?? "";
    if (!isDatePickerType(options?.type) || typeof initial !== "string" ||
        (initial && valueToNumber(initial, options.type) === undefined) ||
        [options.title, options.locale, options.min, options.max, options.step, options.stepBase].some(value =>
            value !== undefined && typeof value !== "string") ||
        (options.required !== undefined && typeof options.required !== "boolean")) {
        throw new TypeError("Invalid date picker options");
    }
    if (options.locale !== undefined) { new Intl.Locale(options.locale); }
    if (options.ownerElement?.ownerDocument === document) { registerDatePickerWindow(); }
    const runtime = getDatePickerRuntime(options.ownerElement);
    const ticket = ++runtime.sequence;
    const doc = runtime.document;
    const view = doc.defaultView;
    const lang = runtime.languages();
    let resolve: (value: TDatePickerResult) => void;
    const result = new Promise<TDatePickerResult>(callback => { resolve = callback; });
    let active = true;
    let closing = false;
    const resources: {dialog?: ReturnType<typeof runtime.createDialog>; field?: ReturnType<typeof createDateField>;
        observer?: MutationObserver; releaseMenu?: () => void} = {};
    const finish = (terminal: TDatePickerResult) => {
        if (!active) { return; }
        active = false;
        if (runtime.current === current) { runtime.current = undefined; }
        owner?.sessions.delete(ownerDestroyed);
        resources.observer?.disconnect();
        resources.releaseMenu?.();
        view.removeEventListener("pagehide", ownerDestroyed);
        resources.field?.destroy();
        if (!closing) { resources.dialog?.destroy(); }
        resolve(terminal);
    };
    const cancel = (reason: TDatePickerCancelReason) => finish({type: "cancel", reason});
    const ownerDestroyed = () => cancel("owner-destroyed");
    const current = {cancel: () => cancel("replaced")};
    const alive = () => options.ownerElement.isConnected && options.ownerElement.ownerDocument === doc &&
        !options.ownerElement.closest('[data-dialog-closing="true"]') && !view.closed && owner?.isActive() !== false;
    const handle = {result, destroy: () => cancel("destroy")};
    runtime.current?.cancel();
    if (ticket !== runtime.sequence) { cancel("replaced"); return handle; }
    if (!alive()) {
        cancel("owner-destroyed"); return handle;
    }
    runtime.current = current;
    owner?.sessions.add(ownerDestroyed);
    try {
        const dialog = resources.dialog = runtime.createDialog({title: " ", content: "", width: "380px",
            beforeClose: () => { closing = true; cancel("dismiss"); return true; },
            destroyCallback: () => cancel("dismiss"),
        });
        if (!active) { dialog.destroy(); return handle; }
        if (!alive()) { ownerDestroyed(); return handle; }
        if (getMenuOwnerElement(options.ownerElement)) {
            dialog.element.dataset.menu = "true";
            resources.releaseMenu = registerMenuOverlay(options.ownerElement, dialog.element, ownerDestroyed);
        } else if (options.ownerElement.closest('[data-menu="true"]')) { dialog.element.dataset.menu = "true"; }
        dialog.element.querySelector<HTMLElement>(".b3-dialog__header").textContent = options.title ||
            (options.type === "time" ? lang.datePickerTime : lang.date);
        const content = doc.createElement("div");
        content.className = "b3-dialog__content";
        content.dir = view.getComputedStyle(options.ownerElement).direction;
        const actions = doc.createElement("div");
        actions.className = "b3-dialog__action";
        const createButton = (label: string, cancel = false) => {
            const button = doc.createElement("button");
            button.type = "button";
            button.className = "b3-button" + (cancel ? " b3-button--cancel" : "") + (doc.getElementById("sidebar") ? " b3-button--touch" : "");
            button.textContent = label;
            return button;
        };
        const dismiss = createButton(lang.cancel, true);
        const apply = createButton(lang.confirm);
        apply.dataset.action = "confirm";
        dismiss.dataset.action = "cancel";
        const spacer = doc.createElement("span");
        spacer.className = "fn__space";
        actions.append(dismiss, spacer, apply);
        dialog.element.querySelector(".b3-dialog__body").append(content, actions);
        const field = resources.field = createDateField(content, {...options, value: initial, languages: lang,
            stepBase: options.stepBase ?? initial,
            onStateChange: () => { if (resources.field) { apply.disabled = !resources.field.validate(); } },
            onSelect: () => { if (options.autoConfirm && options.type === "date") { confirm(); } },
        });
        apply.disabled = !field.validate();
        const confirm = () => {
            if (!active) { return; }
            if (!alive()) { ownerDestroyed(); return; }
            const value = field.commit();
            if (value !== undefined) {
                const changed = value === "" || initial === "" ? value !== initial :
                    valueToNumber(value, options.type) !== valueToNumber(initial, options.type);
                finish({type: "confirm", value, changed});
            }
        };
        apply.addEventListener("click", confirm);
        dismiss.addEventListener("click", () => cancel("cancel"));
        dialog.element.addEventListener("keydown", event => {
            if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
                event.preventDefault(); event.stopPropagation(); cancel("escape");
            }
        }, true);
        dialog.element.addEventListener("keydown", event => {
            if (event.key === "Enter" && !event.isComposing && event.keyCode !== 229 && !event.repeat &&
                (event.target as HTMLElement).closest(".date-picker__fields")) {
                event.preventDefault(); event.stopPropagation(); confirm();
            } else { event.stopPropagation(); }
        });
        ["pointerdown", "mousedown", "click", "dblclick"].forEach(name => {
            dialog.element.addEventListener(name, event => event.stopPropagation());
        });
        resources.observer = new view.MutationObserver(() => {
            if (!alive() || !dialog.element.isConnected) { ownerDestroyed(); }
        });
        resources.observer.observe(doc.documentElement, {childList: true, subtree: true,
            attributes: true, attributeFilter: ["data-dialog-closing"]});
        view.addEventListener("pagehide", ownerDestroyed, {once: true});
        if (dialog.focusWhenReady) { dialog.focusWhenReady(field.focusTarget); }
        else { field.focus(); }
        if (!alive()) { ownerDestroyed(); }
    } catch (error) {
        cancel("destroy");
        console.error("Could not open date picker", error);
    }
    return handle;
};

export {bindDatePicker, isDatePickerOpen} from "./binding";
