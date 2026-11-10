import {MobileDialog} from "../../dialog/mobileDialog";
import {isMobile} from "../../util/functions";

export const openPdfMobileOverlay = (element: HTMLElement, onClose: () => void) => {
    if (!isMobile() || !["passwordDialog", "documentPropertiesDialog"].includes(element.id)) return;
    const placeholder = document.createComment("pdf-dialog");
    element.before(placeholder);
    element.classList.add("pdf-mobile-dialog", "b3-dialog__content");
    const actions = element.querySelector<HTMLElement>(".buttonRow");
    const actionPlaceholder = document.createComment("pdf-dialog-actions");
    actions?.before(actionPlaceholder);
    actions?.classList.add("b3-dialog__action");
    actions?.remove();
    let resolveClosed: () => void;
    const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
    const dialog = new MobileDialog({
        content: "",
        destroyCallback: () => {
            if (actions) {
                actionPlaceholder.replaceWith(actions);
                actions.classList.remove("b3-dialog__action");
            }
            placeholder.replaceWith(element);
            element.classList.remove("pdf-mobile-dialog", "b3-dialog__content", "dialog--open");
            onClose();
            // 密码提交回调先读取并清除输入，关闭事件只结算尚未处理的取消。
            queueMicrotask(() => element.dispatchEvent(new Event("close")));
            resolveClosed();
        },
    });
    dialog.element.querySelector(".b3-dialog__body").append(element);
    if (actions && element.id === "passwordDialog") dialog.element.querySelector(".b3-dialog__body").append(actions);
    return {dialog, closed};
};
