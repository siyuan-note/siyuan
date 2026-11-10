import type {Plugin} from "../plugin";
import {IColorValue, parseColor, TColorInput} from "./model";
import {ColorSession, TColorCancelReason, TColorPickerResult} from "./session";
import {createColorField} from "./field";
import {getColorPickerRuntime} from "./runtime";
import {getColorPickerOwner} from "./owners";
import {registerColorPickerWindow} from "./panel";

export interface IColorPickerOptions {
    value: TColorInput;
    title?: string;
    ownerPlugin: Plugin;
    ownerElement: HTMLElement;
    onPreview?: (value: IColorValue) => void;
    onPreviewEnd?: () => void;
}
export interface IColorPickerHandle {
    result: Promise<TColorPickerResult>;
    destroy(): void;
}

export const openColorPicker = (options: IColorPickerOptions): IColorPickerHandle => {
    const owner = getColorPickerOwner(options?.ownerPlugin);
    return openInternalColorPicker(options, {sessions: owner.sessions, isActive: () => owner.active});
};

export const openInternalColorPicker = (options: Omit<IColorPickerOptions, "ownerPlugin">,
                                         owner?: {sessions: Set<() => void>; isActive: () => boolean}): IColorPickerHandle => {
    const initial = parseColor(options?.value);
    if (!initial) { throw new TypeError("Invalid sRGB color"); }
    if ((options.title !== undefined && typeof options.title !== "string") ||
        (options.onPreview !== undefined && typeof options.onPreview !== "function") ||
        (options.onPreviewEnd !== undefined && typeof options.onPreviewEnd !== "function")) {
        throw new TypeError("Invalid color picker options");
    }
    if (options.ownerElement?.ownerDocument === document) { registerColorPickerWindow(); }
    const runtime = getColorPickerRuntime(options.ownerElement);
    const ticket = ++runtime.sequence;
    const doc = runtime.document;
    const view = doc.defaultView;
    const lang = runtime.languages();
    const session = new ColorSession(initial.hex);
    let resolve: (result: TColorPickerResult) => void;
    const result = new Promise<TColorPickerResult>(callback => { resolve = callback; });
    const resources: {dialog?: ReturnType<typeof runtime.createDialog>; field?: ReturnType<typeof createColorField>; observer?: MutationObserver} = {};
    let frame = 0;
    let lastPreview = initial.hex;
    let pending: IColorValue;
    let cleaned = false;
    let closing = false;
    const safe = (callback?: () => void) => {
        try { callback?.(); } catch (error) { console.error("Color picker callback failed", error); }
    };
    const finish = (reason?: TColorCancelReason) => {
        const terminal = session.finish(reason);
        if (!terminal) { return; }
        resolve(terminal);
        if (runtime.current === current) { runtime.current = undefined; }
        owner?.sessions.delete(ownerDestroyed);
        if (frame) { view.cancelAnimationFrame(frame); frame = 0; }
        resources.observer?.disconnect();
        view.removeEventListener("pagehide", ownerDestroyed);
        resources.field?.destroy();
        if (!cleaned) { cleaned = true; safe(options.onPreviewEnd); }
        if (!closing) { safe(() => resources.dialog?.destroy()); }
    };
    const ownerDestroyed = () => finish("owner-destroyed");
    const current = {cancel: () => finish("replaced")};
    const handle = {result, destroy: () => finish("destroy")};
    runtime.current?.cancel();
    if (ticket !== runtime.sequence) { finish("replaced"); return handle; }
    if (owner?.isActive() === false || !options.ownerElement.isConnected || options.ownerElement.ownerDocument !== doc || view.closed) {
        finish("owner-destroyed"); return handle;
    }
    runtime.current = current;
    owner?.sessions.add(ownerDestroyed);
    const createPanel = () => {
        const dialog = resources.dialog = runtime.createDialog({
            title: " ", content: "", width: "360px",
            beforeClose: () => { closing = true; finish("dismiss"); return true; },
            destroyCallback: () => finish("dismiss"),
        });
        const title = dialog.element.querySelector<HTMLElement>(".b3-dialog__header");
        if (title) { title.textContent = options.title || lang.color; }
        const container = dialog.element.querySelector<HTMLElement>(".b3-dialog__body");
        const content = doc.createElement("div");
        content.className = "b3-dialog__content";
        const actions = doc.createElement("div");
        actions.className = "b3-dialog__action";
        const cancel = doc.createElement("button");
        cancel.type = "button";
        const touchClass = doc.getElementById("sidebar") ? " b3-button--touch" : "";
        cancel.className = "b3-button b3-button--cancel" + touchClass;
        cancel.textContent = lang.cancel;
        const apply = doc.createElement("button");
        apply.type = "button";
        apply.className = "b3-button" + touchClass;
        apply.textContent = lang.confirm;
        const space = doc.createElement("span");
        space.className = "fn__space";
        actions.append(cancel, space, apply);
        container.append(content, actions);
        const field = resources.field = createColorField(content, {value: initial.hex, label: options.title || lang.color, languages: lang,
            onStateChange: () => { if (resources.field) { apply.disabled = resources.field.validate() !== "valid"; } },
            onPreview: value => {
                if (!session.active || !session.update(value.hex)) { return; }
                pending = value;
                if (!frame) {
                    frame = view.requestAnimationFrame(() => {
                        frame = 0;
                        if (session.active && pending.hex !== lastPreview) {
                            lastPreview = pending.hex;
                            safe(() => options.onPreview?.(parseColor(pending.hex)));
                        }
                    });
                }
            },
        });
        const confirm = () => {
            if (!session.active) { return; }
            const draft = field.commitDraft();
            if (!draft.ok) { field.focusError(); return; }
            session.update(draft.value.hex);
            finish();
        };
        apply.addEventListener("click", confirm);
        cancel.addEventListener("click", () => finish("cancel"));
        dialog.element.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                event.preventDefault(); event.stopPropagation(); finish("escape");
            } else if (event.key === "Enter" && !event.isComposing && !event.repeat) {
                event.preventDefault(); event.stopPropagation(); confirm();
            }
        }, true);
        const observer = resources.observer = new view.MutationObserver(() => {
            if (!options.ownerElement.isConnected || options.ownerElement.ownerDocument !== doc || !dialog.element.isConnected) {
                finish("owner-destroyed");
            }
        });
        observer.observe(doc.documentElement, {childList: true, subtree: true});
        view.addEventListener("pagehide", ownerDestroyed, {once: true});
        const dialogRoot = dialog.element.querySelector<HTMLElement>(".b3-dialog");
        dialogRoot.tabIndex = -1;
        dialogRoot.focus({preventScroll: true});
    };
    try { createPanel(); } catch (error) {
        finish("destroy");
        console.error("Could not open color picker", error);
    }
    return handle;
};
