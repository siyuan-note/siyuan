import {bindAnchoredInputPosition} from "./anchoredInputPosition";
import {callMobileAppShowKeyboard} from "../mobile/util/mobileAppUtil";

let activeInput: {mask: HTMLElement, close: (save: boolean, restoreFocus?: boolean) => void};

export const getAnchoredInputMask = () => activeInput?.mask;

export const closeAnchoredInput = (save: boolean) => activeInput?.close(save, true);

export const openAnchoredInput = (options: {
    anchor: HTMLElement,
    value: string,
    label: string,
    isValid: () => boolean,
    save: (value: string) => void
}) => {
    activeInput?.close(true);
    const mask = document.createElement("div");
    mask.className = "b3-text-field__mask";
    mask.style.zIndex = (++window.siyuan.zIndex).toString();
    mask.setAttribute("role", "dialog");
    mask.setAttribute("aria-modal", "true");
    mask.setAttribute("aria-label", options.label);
    const input = document.createElement("textarea");
    input.className = "b3-text-field";
    input.rows = 1;
    input.value = options.value;
    input.setAttribute("aria-label", options.label);
    mask.append(input);
    document.body.append(mask);
    const disposePosition = bindAnchoredInputPosition(input, () => options.anchor, undefined, true);
    let finished = false;
    const close = (save: boolean, restoreFocus = false) => {
        if (finished) {
            return;
        }
        finished = true;
        if (activeInput?.mask === mask) {
            activeInput = undefined;
        }
        ownerObserver.disconnect();
        disposePosition();
        mask.remove();
        if (save && options.isValid()) {
            options.save(input.value);
        }
        if (restoreFocus && options.anchor.isConnected) {
            options.anchor.focus({preventScroll: true});
        }
    };
    // 正文重绘、锁定或标题更新后，关闭失效草稿，避免留下遮罩或覆盖新内容。
    const ownerObserver = new MutationObserver(() => {
        if (!mask.isConnected || !options.isValid()) {
            close(false);
        }
    });
    ownerObserver.observe(document.body, {childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "data-readonly", "data-title", "title"]});
    activeInput = {mask, close};
    input.addEventListener("blur", () => close(true));
    input.addEventListener("keydown", event => {
        event.stopPropagation();
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        if (event.key === "Enter" || event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            close(event.key !== "Escape", true);
        }
    });
    for (const name of ["input", "beforeinput", "keyup", "compositionstart", "compositionend", "paste", "cut", "copy", "focusout", "dblclick"]) {
        input.addEventListener(name, event => event.stopPropagation());
    }
    mask.addEventListener("mousedown", event => {
        event.stopPropagation();
        if (event.target === mask) {
            event.preventDefault();
        }
    });
    mask.addEventListener("pointerdown", event => event.stopPropagation());
    mask.addEventListener("click", event => {
        event.stopPropagation();
        if (event.target === mask) {
            event.preventDefault();
            close(true, true);
        }
    });
    input.focus({preventScroll: true});
    input.select();
    callMobileAppShowKeyboard();
    return close;
};
