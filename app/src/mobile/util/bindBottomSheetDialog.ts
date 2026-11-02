import type {Dialog} from "../../dialog";
import {bindBottomSheetDrag} from "./bindBottomSheetDrag";
import {waitForSheetViewport} from "../../menus/sheetOpen";
import type {MobileSheetMode} from "./mobileSheetLayout";

export const bindBottomSheetDialog = (dialog: Dialog, close: (reason?: "drag" | "close") => Promise<void>, afterResize?: () => void,
                                     afterOpen?: () => void, layoutOptions?: {mode?: MobileSheetMode, expandable?: boolean, disableClose?: boolean}) => {
    dialog.element.classList.add("mobile-bottom-sheet-dialog");
    const sheet = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    // 初始定位不参与过渡，等待视口恢复后再从底部展开。
    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    sheet.style.visibility = "hidden";
    sheet.classList.add("mobile-bottom-sheet");
    const layout = layoutOptions ? (require("./mobileSheetLayout") as typeof import("./mobileSheetLayout")).bindMobileSheetLayout(dialog.element.querySelector<HTMLElement>(".b3-dialog"),
        sheet, {...layoutOptions, onResize: afterResize}) : undefined;
    let mode = layoutOptions?.mode || "standard";
    let actions: HTMLElement;
    const setMode = (next: MobileSheetMode) => {
        mode = next;
        layout?.setMode(next);
        if (actions) {
            (require("../../menus/sheetActions") as typeof import("../../menus/sheetActions"))
                .setSheetExpanded(dialog.element, next === "expanded");
        }
    };
    if (layout && (layoutOptions.expandable || mode === "expanded")) {
        const {getSheetActionsHTML} = require("../../menus/sheetActions") as typeof import("../../menus/sheetActions");
        actions = document.createElement("div");
        actions.className = "mobile-sheet-actions";
        actions.innerHTML = getSheetActionsHTML();
        sheet.append(actions);
        actions.querySelector('[data-type="sheet-expand"]').addEventListener("click", () => {
            setMode(mode === "expanded" ? "standard" : "expanded");
        });
        const closeButton = actions.querySelector<HTMLButtonElement>('[data-type="sheet-close"]');
        closeButton.disabled = !!layoutOptions.disableClose;
        closeButton.addEventListener("click", () => { void close("close").catch(error => console.error(error)); });
        setMode(mode);
    }
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
        if (layout) {
            layout.resize();
        } else if (viewport) {
            container.style.top = `${viewport.offsetTop}px`;
            container.style.height = `${viewport.height}px`;
        }
        if (!layout) afterResize?.();
    };
    if (!layout) {
        window.visualViewport?.addEventListener("resize", resize);
        window.visualViewport?.addEventListener("scroll", resize);
    }
    resize();
    let cancelOpen: () => void;
    let opening = false;
    const updateOpen = () => {
        if (!dialog.element.classList.contains("b3-dialog--open")) {
            if (dialog.element.dataset.dialogClosing === "true") layout?.freeze();
            cancelOpen?.();
            return;
        }
        if (opening) {
            return;
        }
        opening = true;
        const size = window.siyuan.mobile.size;
        const orientation = size.isLandscape ? size.landscape : size.portrait;
        cancelOpen = waitForSheetViewport({
            height: () => Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight),
            fullHeight: Math.max(window.innerHeight, orientation?.height1 || 0),
            now: () => performance.now(),
            requestFrame: callback => requestAnimationFrame(callback),
            cancelFrame: id => cancelAnimationFrame(id),
            open: () => {
                if (!dialog.element.isConnected || !dialog.element.classList.contains("b3-dialog--open")) {
                    return;
                }
                resize();
                sheet.style.visibility = "";
                void sheet.offsetHeight;
                sheet.style.transition = "";
                void sheet.offsetHeight;
                sheet.style.transform = "";
                afterOpen?.();
            },
        });
    };
    const observer = new MutationObserver(updateOpen);
    observer.observe(dialog.element, {attributes: true, attributeFilter: ["class"]});
    updateOpen();
    const disposeDrag = bindBottomSheetDrag(sheet, dialog.element.querySelector(".b3-dialog__scrim"), () => close("drag"));
    const dispose = () => {
        cancelOpen?.();
        layout?.dispose();
        observer.disconnect();
        disposeDrag();
        handle.remove();
        actions?.remove();
        window.visualViewport?.removeEventListener("resize", resize);
        window.visualViewport?.removeEventListener("scroll", resize);
    };
    dispose.freeze = () => layout?.freeze();
    dispose.setMode = setMode;
    return dispose;
};
