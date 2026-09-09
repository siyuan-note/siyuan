import type {Dialog} from "../../dialog";
import {bindBottomSheetDrag} from "./bindBottomSheetDrag";

export const bindBottomSheetDialog = (dialog: Dialog, close: () => Promise<void>) => {
    dialog.element.classList.add("mobile-bottom-sheet-dialog");
    const sheet = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    sheet.classList.add("mobile-bottom-sheet");
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
        window.visualViewport?.removeEventListener("resize", resize);
        window.visualViewport?.removeEventListener("scroll", resize);
    };
};
