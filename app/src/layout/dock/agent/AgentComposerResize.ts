// 输入框默认随内容增高；手动调节后保持所选高度，发送或双击把手恢复自动尺寸。
export const bindAgentComposerResize = (panel: HTMLElement, composer: HTMLElement, handle: HTMLElement) => {
    const windowSelf = panel.ownerDocument.defaultView;
    let preferred: number | undefined;
    let minimum = 40;
    let maximum = 240;
    let value = 240;
    let drag: {id: number, y: number, height: number, previous?: number, moved?: boolean} | undefined;
    const update = () => {
        const style = windowSelf.getComputedStyle(panel);
        const height = Math.min(panel.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
            windowSelf.visualViewport?.height || windowSelf.innerHeight);
        if (height <= 0) {
            return;
        }
        minimum = Math.max(40, Math.ceil(parseFloat(windowSelf.getComputedStyle(composer).minHeight)) || 0);
        // 给标题、操作栏和会话正文留出空间，软键盘弹出时也不能把发送按钮挤出面板。
        maximum = Math.max(minimum, Math.floor(height - 160));
        const limit = Math.round(Math.max(minimum, Math.min(maximum, preferred ?? maximum)));
        composer.style.maxHeight = `${limit}px`;
        composer.style.height = preferred === undefined ? "" : `${limit}px`;
        value = composer.clientHeight;
        handle.setAttribute("aria-valuemin", String(minimum));
        handle.setAttribute("aria-valuemax", String(maximum));
        handle.setAttribute("aria-valuenow", String(value));
    };
    const finish = (cancel: boolean) => {
        if (!drag) {
            return;
        }
        const previous = drag;
        drag = undefined;
        if (cancel) {
            preferred = previous.previous;
            update();
        }
        handle.classList.remove("touch-resize-active");
        if (handle.hasPointerCapture(previous.id)) {
            handle.releasePointerCapture(previous.id);
        }
    };
    const down = (event: PointerEvent) => {
        if (event.button !== 0 || drag) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        update();
        drag = {id: event.pointerId, y: event.clientY, height: composer.clientHeight, previous: preferred};
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("touch-resize-active");
    };
    const move = (event: PointerEvent) => {
        if (!drag || drag.id !== event.pointerId) {
            return;
        }
        if (!drag.moved && Math.abs(event.clientY - drag.y) < 3) {
            return;
        }
        event.preventDefault();
        drag.moved = true;
        preferred = Math.max(minimum, Math.min(maximum, drag.height + drag.y - event.clientY));
        update();
    };
    const up = (event: PointerEvent) => {
        if (drag?.id === event.pointerId) {
            move(event);
            finish(false);
        }
    };
    const cancel = () => finish(true);
    const cancelKeydown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && drag) {
            cancel();
            event.preventDefault();
            event.stopPropagation();
        }
    };
    const keydown = (event: KeyboardEvent) => {
        update();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            preferred = Math.max(minimum, Math.min(maximum, value + (event.key === "ArrowUp" ? 24 : -24)));
            update();
        } else if (event.key === "Home" || event.key === "End") {
            preferred = event.key === "Home" ? minimum : maximum;
            update();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };
    const reset = () => {
        finish(true);
        preferred = undefined;
        update();
    };
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", cancel);
    handle.addEventListener("lostpointercapture", cancel);
    handle.addEventListener("keydown", keydown);
    handle.addEventListener("dblclick", reset);
    windowSelf.addEventListener("blur", cancel);
    windowSelf.addEventListener("keydown", cancelKeydown, true);
    windowSelf.addEventListener("resize", update);
    windowSelf.visualViewport?.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    observer.observe(composer);
    update();
    const destroy = () => {
        finish(true);
        observer.disconnect();
        handle.removeEventListener("pointerdown", down);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", cancel);
        handle.removeEventListener("lostpointercapture", cancel);
        handle.removeEventListener("keydown", keydown);
        handle.removeEventListener("dblclick", reset);
        windowSelf.removeEventListener("blur", cancel);
        windowSelf.removeEventListener("keydown", cancelKeydown, true);
        windowSelf.removeEventListener("resize", update);
        windowSelf.visualViewport?.removeEventListener("resize", update);
        composer.style.maxHeight = "";
        composer.style.height = "";
    };
    return {reset, destroy};
};
