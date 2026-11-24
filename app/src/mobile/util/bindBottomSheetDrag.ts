import {getMobileSheetDragAction} from "./mobileSheetGesture";
import {isIOSPlatform} from "../../protyle/util/browserCompatibility";
import {isNativeTextSelectionHandleTouch} from "../../protyle/wysiwyg/nativeTextMenu";

type SheetDragOptions = {
    grip?: HTMLElement,
    expand?: () => void,
    canStart?: () => boolean,
    isClosing?: () => boolean,
    scrimOpacity?: number,
};

export const bindBottomSheetDrag = (element: HTMLElement, scrim: HTMLElement,
                                    close: () => Promise<void | boolean>, options: SheetDragOptions = {}) => {
    let start: {x: number, y: number, time: number, id: number, fromGrip: boolean};
    let dragging = false;
    let closing = false;
    let disposed = false;
    let suppressClickUntil = 0;
    const clearGesture = () => {
        start = undefined;
        dragging = false;
    };
    const exitOwnsVisuals = () => {
        if (!disposed && !closing && !options.isClosing?.()) return false;
        clearGesture();
        return true;
    };
    const reset = () => {
        element.style.transition = "";
        element.style.transform = "";
        scrim.style.opacity = "";
        clearGesture();
    };
    const onStart = (event: TouchEvent) => {
        if (exitOwnsVisuals()) return;
        if (options.canStart?.() === false || event.touches.length !== 1) {
            onCancel();
            return;
        }
        reset();
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select, button, [contenteditable="true"], .protyle, .block__icon, .b3-dialog__close, [draggable="true"]')) return;
        if (isIOSPlatform(navigator)) {
            const editor = element.ownerDocument.activeElement?.closest<HTMLElement>(".protyle-wysiwyg");
            if (editor && element.contains(editor) && isNativeTextSelectionHandleTouch(event, editor)) return;
        }
        let parent = target;
        while (parent && parent !== element) {
            if (parent.scrollHeight > parent.clientHeight + 1 && parent.scrollTop > 0 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(parent).overflowY)) return;
            parent = parent.parentElement;
        }
        const touch = event.touches[0];
        start = {x: touch.clientX, y: touch.clientY, time: performance.now(), id: touch.identifier,
            fromGrip: !!options.grip?.contains(target)};
    };
    const findTouch = (touches: TouchList) => Array.from(touches).find(touch => touch.identifier === start?.id);
    const onMove = (event: TouchEvent) => {
        if (exitOwnsVisuals() || !start) return;
        const touch = findTouch(event.touches);
        if (event.touches.length !== 1 || !touch || options.canStart?.() === false) {
            onCancel();
            return;
        }
        const offset = touch.clientY - start.y;
        if (!dragging && Math.max(Math.abs(touch.clientX - start.x), Math.abs(offset)) < 4) return;
        if (!dragging && Math.abs(touch.clientX - start.x) > Math.abs(offset)) {
            onCancel();
            return;
        }
        if (!dragging && Math.abs(offset) < 4) return;
        if (!dragging && !start.fromGrip && offset <= 0) {
            onCancel();
            return;
        }
        dragging = true;
        element.style.transition = "none";
        const excess = Math.max(0, offset);
        element.style.transform = `translateY(${excess}px)`;
        scrim.style.opacity = Math.max(0, (options.scrimOpacity ?? 1) *
            (1 - excess / Math.max(element.clientHeight, 1))).toString();
        if (event.cancelable) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => {
        if (exitOwnsVisuals() || !start) return;
        const touch = findTouch(event.changedTouches);
        if (!touch) return;
        if (options.canStart?.() === false) {
            onCancel();
            return;
        }
        if (!dragging) {
            reset();
            return;
        }
        const offset = touch.clientY - start.y;
        const action = getMobileSheetDragAction(offset, performance.now() - start.time, element.clientHeight, start.fromGrip);
        suppressClickUntil = performance.now() + 300;
        void element.offsetHeight;
        element.style.transition = "";
        clearGesture();
        if (action === "close") {
            closing = true;
            void Promise.resolve().then(close).then(accepted => {
                if (disposed) return;
                // 直接绑定者可能没有返回布尔值；退出状态由宿主对话框确认。
                if (accepted === true || options.isClosing?.() || !element.isConnected) return;
                closing = false;
                reset();
            }).catch(error => {
                console.error(error);
                if (!disposed && !options.isClosing?.()) {
                    closing = false;
                    reset();
                }
            });
        } else {
            reset();
            if (action === "expand") options.expand?.();
        }
    };
    const onCancel = () => {
        if (exitOwnsVisuals() || !start) return;
        if (dragging) suppressClickUntil = performance.now() + 300;
        reset();
    };
    const onClick = (event: MouseEvent) => {
        if (performance.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    element.addEventListener("touchstart", onStart, {passive: true});
    element.addEventListener("touchmove", onMove, {passive: false});
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onCancel);
    element.addEventListener("click", onClick, true);
    window.addEventListener("resize", onCancel);
    window.addEventListener("orientationchange", onCancel);
    window.visualViewport?.addEventListener("resize", onCancel);
    window.visualViewport?.addEventListener("scroll", onCancel);
    window.screen.orientation?.addEventListener?.("change", onCancel);
    const dispose = () => {
        disposed = true;
        clearGesture();
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onCancel);
        element.removeEventListener("click", onClick, true);
        window.removeEventListener("resize", onCancel);
        window.removeEventListener("orientationchange", onCancel);
        window.visualViewport?.removeEventListener("resize", onCancel);
        window.visualViewport?.removeEventListener("scroll", onCancel);
        window.screen.orientation?.removeEventListener?.("change", onCancel);
    };
    dispose.cancel = onCancel;
    return dispose;
};
