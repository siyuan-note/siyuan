type TPoint = {clientX: number, clientY: number};

interface IBlockDragSelectionOptions {
    canStart: () => boolean;
    getStartBlock: (target: HTMLElement) => HTMLElement | undefined;
    getBlockAtPoint: (point: TPoint) => HTMLElement | undefined;
    select: (start: HTMLElement, end: HTMLElement) => void;
    scroll: (point?: TPoint) => void;
    finish: (cancelled: boolean) => void;
}

// 鼠标文字选区保留在单个编辑宿主内，跨块拖动由应用维护整块选区。
export const bindBlockDragSelectionGesture = (element: HTMLElement, getScrollElement: () => HTMLElement,
                                              options: IBlockDragSelectionOptions) => {
    const ownerDocument = element.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    let gesture: {
        block: HTMLElement,
        active: boolean, lastPoint: TPoint,
    } | undefined;
    let suppressClickUntil = 0;
    let lastTouchTime = 0;
    let composing = false;
    let scrollElement: HTMLElement;

    const finish = (cancelled: boolean) => {
        const previous = gesture;
        gesture = undefined;
        ownerDocument.removeEventListener("mousemove", mouseMove, true);
        ownerDocument.removeEventListener("mouseup", mouseUp, true);
        ownerDocument.removeEventListener("keydown", keyDown, true);
        ownerDocument.removeEventListener("dragstart", dragStart, true);
        scrollElement?.removeEventListener("scroll", scroll);
        scrollElement = undefined;
        ownerWindow.removeEventListener("blur", cancel);
        if (previous?.active) {
            suppressClickUntil = Date.now() + 500;
            options.scroll();
            options.finish(cancelled);
        }
    };
    const cancel = () => finish(true);
    const keyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
            cancel();
        }
    };
    const dragStart = (event: DragEvent) => {
        if (gesture?.active) {
            event.preventDefault();
        } else {
            cancel();
        }
    };
    const update = (point: TPoint) => {
        if (!gesture || composing || !element.contains(gesture.block) || !options.canStart()) {
            cancel();
            return false;
        }
        const end = options.getBlockAtPoint(point);
        if (!gesture.active && (!end || end === gesture.block)) {
            return false;
        }
        gesture.active = true;
        gesture.lastPoint = point;
        if (end) {
            options.select(gesture.block, end);
        }
        options.scroll(point);
        return true;
    };
    const scroll = () => {
        if (gesture?.active) {
            update(gesture.lastPoint);
        }
    };
    const mouseMove = (event: MouseEvent) => {
        if ((event.buttons & 1) === 0) {
            finish(false);
        } else if (update(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    const mouseUp = (event: MouseEvent) => {
        const active = gesture?.active;
        finish(false);
        if (active) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    const start = (target: HTMLElement, point: TPoint) => {
        finish(true);
        suppressClickUntil = 0;
        if (composing || !options.canStart()) {
            return;
        }
        const block = options.getStartBlock(target);
        if (!block) {
            return;
        }
        gesture = {block, active: false, lastPoint: point};
        // 正文宿主先于滚动容器初始化，开始手势时再绑定实际容器。
        scrollElement = getScrollElement();
        ownerDocument.addEventListener("keydown", keyDown, true);
        ownerDocument.addEventListener("dragstart", dragStart, true);
        ownerWindow.addEventListener("blur", cancel);
        scrollElement.addEventListener("scroll", scroll);
        ownerDocument.addEventListener("mousemove", mouseMove, true);
        ownerDocument.addEventListener("mouseup", mouseUp, true);
    };
    const mouseDown = (event: MouseEvent & {sourceCapabilities?: {firesTouchEvents: boolean}}) => {
        if (event.defaultPrevented || event.button !== 0 || event.detail > 1 ||
            event.shiftKey || event.ctrlKey || event.metaKey || event.altKey ||
            event.sourceCapabilities?.firesTouchEvents || Date.now() - lastTouchTime < 500) {
            return;
        }
        start(event.target as HTMLElement, event);
    };
    const recordTouch = () => {
        // 仅记录触摸时间，避免浏览器合成的兼容鼠标事件启动跨块拖选。
        lastTouchTime = Date.now();
    };
    const click = (event: MouseEvent) => {
        if (Date.now() < suppressClickUntil) {
            suppressClickUntil = 0;
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    const compositionStart = () => {
        composing = true;
        cancel();
    };
    const compositionEnd = () => {
        composing = false;
    };
    element.addEventListener("mousedown", mouseDown);
    element.addEventListener("touchstart", recordTouch, {passive: true});
    element.addEventListener("touchend", recordTouch, {passive: true});
    element.addEventListener("touchcancel", recordTouch, {passive: true});
    element.addEventListener("click", click, true);
    element.addEventListener("compositionstart", compositionStart);
    element.addEventListener("compositionend", compositionEnd);
    element.addEventListener("focusout", compositionEnd);
    return () => {
        cancel();
        element.removeEventListener("mousedown", mouseDown);
        element.removeEventListener("touchstart", recordTouch);
        element.removeEventListener("touchend", recordTouch);
        element.removeEventListener("touchcancel", recordTouch);
        element.removeEventListener("click", click, true);
        element.removeEventListener("compositionstart", compositionStart);
        element.removeEventListener("compositionend", compositionEnd);
        element.removeEventListener("focusout", compositionEnd);
    };
};
