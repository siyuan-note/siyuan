import type {Dialog} from "../../dialog";
import {bindBottomSheetDrag} from "./bindBottomSheetDrag";
import {waitForSheetViewport} from "../../menus/sheetOpen";
import type {MobileSheetMode} from "./mobileSheetLayout";
import {bindKeyboardSheetState} from "./keyboardSheetState";

export const bindBottomSheetDialog = (dialog: Dialog, close: () => Promise<void | boolean>, afterResize?: () => void,
                                     afterOpen?: () => void, layoutOptions?: {mode?: MobileSheetMode, canStart?: () => boolean}) => {
    dialog.element.classList.add("mobile-bottom-sheet-dialog");
    const sheet = dialog.element.querySelector<HTMLElement>(".b3-dialog__container");
    sheet.querySelector(".b3-dialog__close")?.remove();
    // 初始定位不参与过渡，等待视口恢复后再从底部展开。
    sheet.style.transition = "none";
    sheet.style.transform = "translateY(100%)";
    sheet.style.visibility = "hidden";
    sheet.classList.add("mobile-bottom-sheet");
    const normalizeActions = () => {
        sheet.querySelectorAll(":scope > .b3-dialog__body .b3-dialog__action").forEach(footer => {
            if (!footer.querySelector(".b3-button")) return;
            footer.classList.add("mobile-sheet-action-bar");
            footer.querySelectorAll(".b3-button")
                .forEach(button => button.classList.add("b3-button--touch", "b3-button--wrap"));
            const directButtons = Array.from(footer.querySelectorAll(":scope > .b3-button"));
            if (directButtons.length) {
                const buttons = Array.from(footer.querySelectorAll(":scope > .b3-button, :scope > .mobile-sheet-action-group > .b3-button"));
                let group = footer.querySelector(":scope > .mobile-sheet-action-group");
                if (!group) {
                    group = document.createElement("div");
                    group.className = "mobile-sheet-action-group";
                    directButtons[0].before(group);
                }
                buttons.forEach(button => group.append(button));
                footer.querySelectorAll(":scope > .fn__space, :scope > .fn__flex-1")
                    .forEach(spacer => spacer.remove());
            }
            footer.querySelectorAll(".mobile-sheet-action-group").forEach(group => {
                const buttons = Array.from(group.querySelectorAll(":scope > .b3-button"));
                group.classList.toggle("mobile-sheet-action-group--stacked", buttons.length > 2);
                buttons.forEach((button, index) => {
                    button.classList.add("b3-button--touch", "b3-button--wrap");
                    if (button.classList.contains("b3-button--cancel")) {
                        button.classList.add("b3-button--secondary");
                    } else if (index === buttons.length - 1 && button.classList.contains("b3-button--text")) {
                        button.classList.add("b3-button--primary");
                    }
                });
            });
        });
    };
    normalizeActions();
    const actionsObserver = new MutationObserver(normalizeActions);
    actionsObserver.observe(sheet, {childList: true, subtree: true});
    const disposeKeyboardState = bindKeyboardSheetState(sheet);
    const dragState: {cancel?: () => void} = {};
    const layout = (require("./mobileSheetLayout") as typeof import("./mobileSheetLayout")).bindMobileSheetLayout(dialog.element.querySelector<HTMLElement>(".b3-dialog"),
        sheet, {...layoutOptions, onResize: afterResize, onGeometryChange: () => dragState.cancel?.()});
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
            if (dialog.element.dataset.dialogClosing === "true") {
                layout.freeze();
                // 退出样式接管拖动位移，保留从当前绘制位置向下滑出的过渡。
                sheet.style.transition = "";
                sheet.style.transform = "";
            }
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
            layout.setPreferredHeight(height);
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
        actionsObserver.disconnect();
        disposeKeyboardState();
        cancelOpen?.();
        layout.dispose();
        observer.disconnect();
        disposeDrag();
        handle.remove();
    };
    dispose.freeze = () => layout.freeze();
    dispose.setMode = layout.setMode;
    return dispose;
};
