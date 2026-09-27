interface ITouchOrderCallbacks {
    start: (row: HTMLElement) => boolean;
    move: (target: Element, clientY: number) => void;
    drop: () => void;
    cancel: () => void;
}

// 只从拖拽柄接管指针，列表其他区域仍可正常滚动和切换开关。
export const bindTouchOrder = (browser: HTMLElement, callbacks: ITouchOrderCallbacks) => {
    let pointer: {id: number, x: number, y: number, startX: number, startY: number, moved: boolean};
    let frame = 0;
    let suppressClick = false;
    const hitTest = () => {
        const target = document.elementFromPoint(pointer.x, pointer.y);
        return target && browser.contains(target) ? target : null;
    };
    const finish = (commit: boolean) => {
        if (!pointer) {
            return;
        }
        const current = pointer;
        pointer = undefined;
        cancelAnimationFrame(frame);
        if (browser.hasPointerCapture(current.id)) {
            browser.releasePointerCapture(current.id);
        }
        if (commit && current.moved) {
            callbacks.drop();
        } else {
            callbacks.cancel();
        }
    };
    const scroll = () => {
        if (!pointer || !browser.isConnected) {
            finish(false);
            return;
        }
        if (pointer.moved) {
            const target = hitTest();
            const list = target?.closest<HTMLElement>(".config-entry-visibility__column-list");
            if (list) {
                const bounds = list.getBoundingClientRect();
                const edge = Math.min(40, bounds.height / 4);
                const delta = pointer.y < bounds.top + edge ? -8 : pointer.y > bounds.bottom - edge ? 8 : 0;
                if (delta) {
                    list.scrollTop += delta;
                }
            }
            callbacks.move(hitTest(), pointer.y);
        }
        frame = requestAnimationFrame(scroll);
    };
    const down = (event: PointerEvent) => {
        if (pointer || !event.isPrimary || event.button !== 0) {
            return;
        }
        suppressClick = false;
        const handle = (event.target as Element).closest(".config-entry-visibility__drag");
        const row = handle?.closest<HTMLElement>("[data-entry-row]");
        if (!row || !browser.contains(row) || !callbacks.start(row)) {
            return;
        }
        pointer = {id: event.pointerId, x: event.clientX, y: event.clientY,
            startX: event.clientX, startY: event.clientY, moved: false};
        suppressClick = true;
        browser.setPointerCapture(event.pointerId);
        event.preventDefault();
        frame = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
        if (pointer?.id !== event.pointerId) {
            return;
        }
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.moved ||= Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) >= 5;
        if (pointer.moved) {
            callbacks.move(hitTest(), pointer.y);
        }
        event.preventDefault();
    };
    const up = (event: PointerEvent) => {
        if (pointer?.id === event.pointerId) {
            move(event);
            finish(true);
        }
    };
    const cancel = (event: PointerEvent) => {
        if (pointer?.id === event.pointerId) {
            finish(false);
        }
    };
    const click = (event: MouseEvent) => {
        if (suppressClick) {
            suppressClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    browser.addEventListener("pointerdown", down);
    browser.addEventListener("pointermove", move);
    browser.addEventListener("pointerup", up);
    browser.addEventListener("pointercancel", cancel);
    browser.addEventListener("lostpointercapture", cancel);
    browser.addEventListener("click", click, true);
    return () => {
        finish(false);
        browser.removeEventListener("pointerdown", down);
        browser.removeEventListener("pointermove", move);
        browser.removeEventListener("pointerup", up);
        browser.removeEventListener("pointercancel", cancel);
        browser.removeEventListener("lostpointercapture", cancel);
        browser.removeEventListener("click", click, true);
    };
};
