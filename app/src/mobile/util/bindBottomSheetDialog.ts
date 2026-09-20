import type {Dialog} from "../../dialog";
import {bindBottomSheetDrag} from "./bindBottomSheetDrag";

export const bindBottomSheetDialog = (dialog: Dialog, close: () => Promise<void>) => {
    dialog.element.classList.add("mobile-bottom-sheet-dialog");
    const sheet = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    sheet.classList.add("mobile-bottom-sheet");
    // 底部面板只支持下拉关闭，不参与通用对话框的移动和缩放。
    sheet.querySelector(".b3-dialog__header")?.classList.remove("resize__move");
    sheet.querySelectorAll(":scope > .resize__rd, :scope > .resize__ld, :scope > .resize__lt, :scope > .resize__rt, " +
        ":scope > .resize__r, :scope > .resize__d, :scope > .resize__t, :scope > .resize__l")
        .forEach(element => element.remove());
    const handle = document.createElement("div");
    // 抓手与菜单抽屉保持一致，由 b3-menu__title 的伪元素绘制
    handle.className = "b3-menu__title b3-menu__title--root";
    handle.setAttribute("aria-hidden", "true");
    sheet.prepend(handle);
    const resize = () => {
        const viewport = window.visualViewport;
        const container = dialog.element.querySelector<HTMLElement>(".b3-dialog");
        if (viewport) {
            container.style.top = `${viewport.offsetTop}px`;
            container.style.height = `${viewport.height}px`;
        }
    };
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    resize();
    const disposeDrag = bindBottomSheetDrag(sheet, dialog.element.querySelector(".b3-dialog__scrim"), close);
    return () => {
        disposeDrag();
        handle.remove();
        window.visualViewport?.removeEventListener("resize", resize);
        window.visualViewport?.removeEventListener("scroll", resize);
    };
};
