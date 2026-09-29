import {Constants} from "../../constants";

type TPoint = {clientX: number, clientY: number};
type TSource = "mouse" | "touch";

interface IBlockDragSelectionOptions {
    canStart: (source: TSource) => boolean;
    getStartBlock: (target: HTMLElement, source: TSource) => HTMLElement | undefined;
    getBlockAtPoint: (point: TPoint) => HTMLElement | undefined;
    isMultiSelectMode: () => boolean;
    select: (start: HTMLElement, end: HTMLElement, source: TSource) => void;
    scroll: (point?: TPoint) => void;
    finish: (source: TSource, cancelled: boolean) => void;
}

// 文字选区保留在单个编辑宿主内，跨块拖动由应用维护整块选区。
export const bindBlockDragSelectionGesture = (element: HTMLElement, getScrollElement: () => HTMLElement,
                                              options: IBlockDragSelectionOptions) => {
    const ownerDocument = element.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    let gesture: {
        source: TSource, block: HTMLElement, point: TPoint, time: number, touchID?: number,
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
        ownerDocument.removeEventListener("touchmove", touchMove, true);
        ownerDocument.removeEventListener("touchend", touchEnd, true);
        ownerDocument.removeEventListener("touchcancel", cancel, true);
        ownerDocument.removeEventListener("touchstart", additionalTouch, true);
        ownerDocument.removeEventListener("keydown", keyDown, true);
        ownerDocument.removeEventListener("dragstart", dragStart, true);
        scrollElement?.removeEventListener("scroll", scroll);
        scrollElement = undefined;
        ownerWindow.removeEventListener("blur", cancel);
        if (previous?.active) {
            suppressClickUntil = Date.now() + 500;
            options.scroll();
            options.finish(previous.source, cancelled);
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
    const update = (point: TPoint, allowSingleBlock = false) => {
        if (!gesture || composing || !element.contains(gesture.block) || !options.canStart(gesture.source)) {
            cancel();
            return false;
        }
        const end = options.getBlockAtPoint(point);
        if (!gesture.active && (!end || end === gesture.block && !allowSingleBlock)) {
            return false;
        }
        gesture.active = true;
        gesture.lastPoint = point;
        if (end) {
            options.select(gesture.block, end, gesture.source);
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
    const additionalTouch = (event: TouchEvent) => {
        if (event.touches.length !== 1) {
            cancel();
        }
    };
    const touchMove = (event: TouchEvent) => {
        const touch = gesture && Array.from(event.touches).find(item => item.identifier === gesture.touchID);
        if (!touch || event.touches.length !== 1 || !event.cancelable) {
            cancel();
            return;
        }
        if (!gesture.active) {
            if (Math.abs(touch.clientX - gesture.point.clientX) < Constants.SIZE_DRAG_THRESHOLD &&
                Math.abs(touch.clientY - gesture.point.clientY) < Constants.SIZE_DRAG_THRESHOLD) {
                return;
            }
            // 普通滑动交给浏览器滚动；多选模式或持续长按后的滑动才尝试扩选。
            if (!options.isMultiSelectMode() && Date.now() - gesture.time < Constants.TIMEOUT_MULTIPLE_SELECT) {
                cancel();
                return;
            }
        }
        if (update(touch, options.isMultiSelectMode())) {
            // 保留冒泡，让移动端全局手势清理自己的长按和侧栏滑动状态。
            event.preventDefault();
        }
    };
    const touchEnd = (event: TouchEvent) => {
        lastTouchTime = Date.now();
        if (!gesture || !Array.from(event.changedTouches).some(item => item.identifier === gesture.touchID)) {
            return;
        }
        const active = gesture.active;
        finish(false);
        if (active) {
            event.preventDefault();
        }
    };
    const start = (target: HTMLElement, point: TPoint, source: TSource, touchID?: number) => {
        finish(true);
        suppressClickUntil = 0;
        if (composing || !options.canStart(source)) {
            return;
        }
        const block = options.getStartBlock(target, source);
        if (!block) {
            return;
        }
        gesture = {source, block, point, time: Date.now(), touchID, active: false, lastPoint: point};
        // 正文宿主先于滚动容器初始化，开始手势时再绑定实际容器。
        scrollElement = getScrollElement();
        ownerDocument.addEventListener("keydown", keyDown, true);
        ownerDocument.addEventListener("dragstart", dragStart, true);
        ownerWindow.addEventListener("blur", cancel);
        scrollElement.addEventListener("scroll", scroll);
        if (source === "mouse") {
            ownerDocument.addEventListener("mousemove", mouseMove, true);
            ownerDocument.addEventListener("mouseup", mouseUp, true);
        } else {
            ownerDocument.addEventListener("touchmove", touchMove, {capture: true, passive: false});
            ownerDocument.addEventListener("touchend", touchEnd, {capture: true, passive: false});
            ownerDocument.addEventListener("touchcancel", cancel, true);
            ownerDocument.addEventListener("touchstart", additionalTouch, true);
        }
        return true;
    };
    const mouseDown = (event: MouseEvent & {sourceCapabilities?: {firesTouchEvents: boolean}}) => {
        if (event.defaultPrevented || event.button !== 0 || event.detail > 1 ||
            event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || gesture?.source === "touch" ||
            event.sourceCapabilities?.firesTouchEvents || Date.now() - lastTouchTime < 500) {
            return;
        }
        start(event.target as HTMLElement, event, "mouse");
    };
    const touchStart = (event: TouchEvent) => {
        lastTouchTime = Date.now();
        if (event.defaultPrevented || event.touches.length !== 1) {
            cancel();
            return;
        }
        const touch = event.touches[0];
        if (start(event.target as HTMLElement, touch, "touch", touch.identifier) && options.isMultiSelectMode()) {
            // 多选模式中的触摸从按下时阻止原生滚动，松手未移动仍交给现有点选处理。
            event.preventDefault();
        }
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
    element.addEventListener("touchstart", touchStart, {passive: false});
    element.addEventListener("click", click, true);
    element.addEventListener("compositionstart", compositionStart);
    element.addEventListener("compositionend", compositionEnd);
    element.addEventListener("focusout", compositionEnd);
    return () => {
        cancel();
        element.removeEventListener("mousedown", mouseDown);
        element.removeEventListener("touchstart", touchStart);
        element.removeEventListener("click", click, true);
        element.removeEventListener("compositionstart", compositionStart);
        element.removeEventListener("compositionend", compositionEnd);
        element.removeEventListener("focusout", compositionEnd);
    };
};
