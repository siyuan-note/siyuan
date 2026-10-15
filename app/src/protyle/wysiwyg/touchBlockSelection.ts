import {hideElements} from "../ui/hideElements";
import {countBlockWord} from "../../layout/status";

// 原生触摸可能只更新文字光标而不派发鼠标事件，进入正文编辑时先清理块选择反馈。
export const clearTouchBlockSelection = (protyle: IProtyle, event: PointerEvent) => {
    const root = protyle.wysiwyg.element;
    const target = event.target as HTMLElement;
    if (!["touch", "pen"].includes(event.pointerType) || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        protyle.toolbar.isMultiSelectMode() || !target.isContentEditable ||
        target.closest(".protyle-wysiwyg") !== root) {
        return;
    }
    if (root.querySelector(".protyle-wysiwyg--select")) {
        hideElements(["select"], protyle);
        countBlockWord([], protyle);
    }
    root.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => item.classList.remove("protyle-wysiwyg--hl"));
};
