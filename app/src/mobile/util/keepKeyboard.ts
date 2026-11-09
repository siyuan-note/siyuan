import {isMobile} from "../../util/functions";

export const preserveMobileEditorKeyboard = (element: HTMLElement) => {
    const active = document.activeElement as HTMLElement;
    if (!isMobile() || !active?.isContentEditable || !element.contains(active)) return;
    // 编辑区进入 inert 前接住输入焦点，等待期间的输入不会写入正在预检的正文。
    const input = document.createElement("textarea");
    input.className = "protyle-keyboard-guard";
    input.tabIndex = -1;
    input.setAttribute("aria-label", window.siyuan.languages.sourceRemovalPending);
    input.addEventListener("beforeinput", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
    });
    input.addEventListener("keydown", event => {
        event.preventDefault();
        event.stopImmediatePropagation();
    });
    document.body.appendChild(input);
    input.focus({preventScroll: true});
    if (document.activeElement !== input) {
        input.remove();
        return;
    }
    return {
        hasFocus: () => document.activeElement === input,
        release: () => input.remove(),
    };
};
