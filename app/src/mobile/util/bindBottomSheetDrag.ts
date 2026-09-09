// 下拉手势沿用移动端菜单的距离和速度阈值，编辑区域保留原生选区及滚动操作。
export const bindBottomSheetDrag = (element: HTMLElement, scrim: HTMLElement, close: () => Promise<void>) => {
    let start: {x: number, y: number, time: number};
    let dragging = false;
    let closing = false;
    let suppressClickUntil = 0;
    const reset = () => {
        element.style.transition = "";
        element.style.transform = "";
        scrim.style.opacity = "";
        start = undefined;
        dragging = false;
    };
    const onStart = (event: TouchEvent) => {
        if (closing) {
            return;
        }
        reset();
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 || target.closest('input, textarea, select, [contenteditable="true"], .protyle, .block__icon, .b3-dialog__close')) {
            return;
        }
        let parent = target;
        while (parent && parent !== element) {
            if (parent.scrollHeight > parent.clientHeight + 1 && parent.scrollTop > 0 &&
                ["auto", "scroll", "overlay"].includes(getComputedStyle(parent).overflowY)) {
                return;
            }
            parent = parent.parentElement;
        }
        const touch = event.touches[0];
        start = {x: touch.clientX, y: touch.clientY, time: performance.now()};
    };
    const onMove = (event: TouchEvent) => {
        if (!start || closing) {
            return;
        }
        if (event.touches.length !== 1) {
            reset();
            return;
        }
        const touch = event.touches[0];
        const offset = touch.clientY - start.y;
        if (!dragging && (offset <= 0 || Math.abs(touch.clientX - start.x) > offset)) {
            start = undefined;
            return;
        }
        dragging = true;
        element.style.transition = "none";
        element.style.transform = `translateY(${Math.max(0, offset)}px)`;
        scrim.style.opacity = Math.max(0, 1 - Math.max(0, offset) / Math.max(element.clientHeight, 1)).toString();
        if (event.cancelable) {
            event.preventDefault();
        }
    };
    const onEnd = (event: TouchEvent) => {
        if (!dragging || !start || !event.changedTouches.length) {
            reset();
            return;
        }
        const offset = Math.max(0, event.changedTouches[0].clientY - start.y);
        const duration = Math.max(performance.now() - start.time, 1);
        const shouldClose = offset > Math.min(120, element.clientHeight * .25) || (offset > 20 && offset / duration > .6);
        suppressClickUntil = performance.now() + 300;
        element.style.transition = "";
        start = undefined;
        dragging = false;
        if (shouldClose) {
            closing = true;
            void close().catch(error => console.error(error)).finally(() => {
                closing = false;
                reset();
            });
        } else {
            reset();
        }
    };
    const onCancel = () => {
        if (!closing) {
            reset();
        }
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
    return () => {
        element.removeEventListener("touchstart", onStart);
        element.removeEventListener("touchmove", onMove);
        element.removeEventListener("touchend", onEnd);
        element.removeEventListener("touchcancel", onCancel);
        element.removeEventListener("click", onClick, true);
    };
};
