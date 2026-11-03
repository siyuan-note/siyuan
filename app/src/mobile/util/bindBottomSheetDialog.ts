import type {Dialog} from "../../dialog";
import {bindBottomSheetDrag} from "./bindBottomSheetDrag";
import {waitForSheetViewport} from "../../menus/sheetOpen";
import type {MobileSheetMode} from "./mobileSheetLayout";

export const bindBottomSheetDialog = (dialog: Dialog, close: () => Promise<void | boolean>, afterResize?: () => void,
                                     afterOpen?: () => void, layoutOptions?: {mode?: MobileSheetMode, expandable?: boolean, canStart?: () => boolean}) => {
    dialog.element.classList.add("mobile-bottom-sheet-dialog");
    const sheet = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    sheet.querySelector(".b3-dialog__close")?.remove();
    // 初始定位不参与过渡，等待视口恢复后再从底部展开。
    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    sheet.style.visibility = "hidden";
    sheet.classList.add("mobile-bottom-sheet");
    const dragState: {cancel?: () => void} = {};
    const layout = (require("./mobileSheetLayout") as typeof import("./mobileSheetLayout")).bindMobileSheetLayout(dialog.element.querySelector<HTMLElement>(".b3-dialog"),
        sheet, {...layoutOptions, onResize: afterResize, onGeometryChange: () => dragState.cancel?.()});
    let mode = layoutOptions?.mode || "standard";
    let actions: HTMLElement;
    let disposeActions: () => void;
    const setMode = (next: MobileSheetMode) => {
        mode = next;
        layout.setMode(next);
        if (actions) {
            (require("../../menus/sheetActions") as typeof import("../../menus/sheetActions"))
                .setSheetExpanded(dialog.element, next === "expanded");
        }
    };
    if (layoutOptions?.expandable || mode === "expanded") {
        const {getSheetActionsHTML, getSheetExpandButtonHTML} = require("../../menus/sheetActions") as typeof import("../../menus/sheetActions");
        actions = sheet.querySelector<HTMLElement>(":scope > .b3-dialog__body > .b3-dialog__action");
        if (actions) {
            const expand = document.createElement("div");
            expand.className = "fn__flex-1";
            expand.innerHTML = getSheetExpandButtonHTML();
            actions.prepend(expand);
            disposeActions = () => expand.remove();
        } else {
            actions = document.createElement("div");
            actions.className = "mobile-sheet-actions";
            actions.innerHTML = getSheetActionsHTML(true);
            sheet.append(actions);
            disposeActions = () => actions.remove();
        }
        actions.querySelector('[data-type="sheet-expand"]').addEventListener("click", () => {
            setMode(mode === "expanded" ? "standard" : "expanded");
        });
        setMode(mode);
    }
    // 底部面板由抓手调整高度，不参与通用对话框的移动和缩放。
    sheet.querySelector(".b3-dialog__header")?.classList.remove("resize__move");
    sheet.querySelectorAll(":scope > .resize__rd, :scope > .resize__ld, :scope > .resize__lt, :scope > .resize__rt, " +
        ":scope > .resize__r, :scope > .resize__d, :scope > .resize__t, :scope > .resize__l")
        .forEach(element => element.remove());
    const handle = document.createElement("div");
    // 抓手与菜单抽屉保持一致，由 b3-menu__title 的伪元素绘制
    handle.className = "b3-menu__title b3-menu__title--root";
    handle.setAttribute("aria-hidden", "true");
    sheet.prepend(handle);
    const resize = () => layout.resize();
    resize();
    let cancelOpen: () => void;
    let opening = false;
    const updateOpen = () => {
        if (!dialog.element.classList.contains("b3-dialog--open")) {
            if (dialog.element.dataset.dialogClosing === "true") layout.freeze();
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
    const disposeDrag = bindBottomSheetDrag(sheet, dialog.element.querySelector(".b3-dialog__scrim"), close, {
        grip: handle,
        getBounds: layout.getBounds,
        resize: height => {
            mode = "standard";
            layout.setPreferredHeight(height);
            if (actions) {
                (require("../../menus/sheetActions") as typeof import("../../menus/sheetActions"))
                    .setSheetExpanded(dialog.element, false);
            }
        },
        canStart: () => {
            const body = sheet.querySelector<HTMLElement>(":scope > .b3-dialog__body");
            return window.siyuan.dialogs?.[window.siyuan.dialogs.length - 1] === dialog &&
                dialog.element.dataset.dialogClosing !== "true" &&
                !dialog.element.closest('[inert], [aria-busy="true"]') &&
                !body?.matches('[inert], [aria-busy="true"]') && layoutOptions?.canStart?.() !== false;
        },
        isClosing: () => dialog.element.dataset.dialogClosing === "true",
    });
    dragState.cancel = disposeDrag.cancel;
    const dispose = () => {
        cancelOpen?.();
        layout.dispose();
        observer.disconnect();
        disposeDrag();
        handle.remove();
        disposeActions?.();
    };
    dispose.freeze = () => layout.freeze();
    dispose.setMode = setMode;
    return dispose;
};
