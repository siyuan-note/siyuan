import {moveSheetGesture, SheetGesture} from "./mobileSheetGesture";

type SheetDragOptions = {
    grip?: HTMLElement,
    getBounds?: () => {min: number, max: number},
    resize?: (height: number) => void,
    canStart?: () => boolean,
    isClosing?: () => boolean,
    scrimOpacity?: number,
};

export const bindBottomSheetDrag = (element: HTMLElement, scrim: HTMLElement,
                                    close: () => Promise<void | boolean>, options: SheetDragOptions = {}) => {
    let start: {x: number, y: number, time: number, id: number};
    let gesture: SheetGesture;
    let dragging = false;
    let closing = false;
    let disposed = false;
    let suppressClickUntil = 0;
    const clearGesture = () => {
        start = undefined;
        gesture = undefined;
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
        if (closing || disposed || options.isClosing?.() || options.canStart?.() === false) return;
        reset();
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 || target.closest('input, textarea, select, button, [contenteditable="true"], .protyle, .block__icon, .b3-dialog__close, [draggable="true"]')) return;
        let parent = target;
        while (parent && parent !== element) {
            if (parent.scrollHeight > parent.clientHeight + 1 && parent.scrollTop > 0 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(parent).overflowY)) return;
            parent = parent.parentElement;
        }
        const touch = event.touches[0];
        start = {x: touch.clientX, y: touch.clientY, time: performance.now(), id: touch.identifier};
        if (options.grip?.contains(target) && options.getBounds && options.resize) {
            const height = element.getBoundingClientRect().height;
            const bounds = options.getBounds();
            gesture = {height, ...bounds, min: Math.min(bounds.min, height), offset: 0, time: start.time};
        }
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
        if (Math.abs(touch.clientX - start.x) > Math.abs(offset)) {
            onCancel();
            return;
        }
        if (!dragging && Math.abs(offset) < 4) return;
        if (!gesture && offset <= 0) {
            onCancel();
            return;
        }
        dragging = true;
        element.style.transition = "none";
        const result = gesture ? moveSheetGesture(gesture, offset, performance.now()) : undefined;
        if (result) options.resize(result.height);
        if (exitOwnsVisuals()) return;
        const excess = result ? result.excess : Math.max(0, offset);
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
        const result = gesture ? moveSheetGesture(gesture, offset, performance.now()) : undefined;
        if (result) options.resize(result.height);
        if (exitOwnsVisuals()) return;
        const duration = Math.max(performance.now() - start.time, 1);
        const shouldClose = result ? result.close : offset > Math.min(120, element.clientHeight * .25) ||
            (offset > 20 && offset / duration > .6);
        suppressClickUntil = performance.now() + 300;
        void element.offsetHeight;
        element.style.transition = "";
        start = undefined;
        gesture = undefined;
        dragging = false;
        if (shouldClose) {
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
        } else reset();
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
