import {MobileDialog} from "./mobileDialog";
import type {openAnchoredInput} from "./anchoredInput";
import {escapeAttr} from "../util/escape";

// 原锚点模态输入仅在业务显式启用时使用抽屉；失焦/Back 保存，Escape/取消放弃。
export const openMobileAnchoredInput = (options: Parameters<typeof openAnchoredInput>[0], onClose: () => void) => {
    let finished = false;
    let disposed = false;
    let unregistered = false;
    const unregister = () => {
        if (unregistered) return;
        unregistered = true;
        onClose();
    };
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        observer.disconnect();
        input.value = "";
        unregister();
    };
    const dialog = new MobileDialog({
        title: options.label,
        content: `<div class="b3-dialog__content"><textarea class="b3-text-field fn__block" rows="1" aria-label="${escapeAttr(options.label)}"></textarea></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-action="cancel">${window.siyuan.languages.cancel}</button>
<div class="fn__space"></div><button class="b3-button b3-button--text" data-action="confirm">${window.siyuan.languages.confirm}</button></div>`,
        mobileSheet: {beforeClose: reason => {
            if (finished) return true;
            if (reason !== "cancel" && reason !== "escape" && options.isValid()) options.save(input.value);
            finished = true;
            observer.disconnect();
            unregister();
            return true;
        }},
        destroyCallback: dispose,
    });
    const input = dialog.element.querySelector<HTMLTextAreaElement>("textarea");
    input.value = options.value;
    const close = (save: boolean) => {
        if (disposed || finished) return;
        if (!options.isValid()) {
            finished = true;
            dispose();
            dialog.invalidate();
        } else {
            void dialog.requestClose(save ? "programmatic" : "cancel");
        }
    };
    const observer = new MutationObserver(() => {
        if (!finished && (!input.isConnected || !options.isValid())) close(false);
    });
    observer.observe(document.body, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "data-readonly", "data-title", "title"]});
    input.addEventListener("blur", event => {
        if (!dialog.element.contains(event.relatedTarget as Node)) close(true);
    });
    input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            void dialog.requestClose(event.key === "Escape" ? "escape" : "confirm");
        }
    });
    dialog.element.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
    dialog.element.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
    dialog.focusWhenReady(() => input, {select: true, showKeyboard: true});
    return {mask: dialog.element.querySelector<HTMLElement>(".b3-dialog"), close};
};
