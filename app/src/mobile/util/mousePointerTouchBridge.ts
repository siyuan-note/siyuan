import {isInAndroid} from "../../protyle/util/compatibility";

type MousePointerTouchEvent = TouchEvent & {
    siyuanMousePointer?: boolean;
};

interface TouchPoint {
    clientX: number;
    clientY: number;
}

export const isMousePointerTouchEvent = (event: TouchEvent) => {
    return (event as MousePointerTouchEvent).siyuanMousePointer === true;
};

// 将移动端 Dock 内的鼠标 Pointer 事件局部转换为 Touch-like 事件，以复用已有的触摸拖拽逻辑。
export const bindMousePointerTouchBridge = (element: Element) => {
    if (!isInAndroid()) {
        return;
    }

    let pointerId: number | null = null;
    let pointerTarget: EventTarget | null = null;
    let captureElement: Element | null = null;
    let lastPoint: TouchPoint = {clientX: 0, clientY: 0};
    let isDragging = false;
    let suppressClick = false;

    const dispatchTouchEvent = (type: "touchstart" | "touchmove" | "touchend" | "touchcancel", point: TouchPoint) => {
        lastPoint = point;
        const touch = {
            clientX: point.clientX,
            clientY: point.clientY,
            target: pointerTarget,
        } as Touch;
        const activeTouches = type === "touchend" || type === "touchcancel" ? [] : [touch];
        const touchEvent = new Event(type, {cancelable: true}) as MousePointerTouchEvent;
        Object.defineProperties(touchEvent, {
            touches: {value: activeTouches},
            targetTouches: {value: activeTouches},
            changedTouches: {value: [touch]},
        });
        touchEvent.siyuanMousePointer = true;
        element.dispatchEvent(touchEvent);
        return touchEvent.defaultPrevented;
    };

    const resetPointer = () => {
        const activePointerId = pointerId;
        pointerId = null;
        pointerTarget = null;
        isDragging = false;
        if (activePointerId !== null && captureElement?.hasPointerCapture(activePointerId)) {
            captureElement.releasePointerCapture(activePointerId);
        }
        captureElement = null;
    };

    const finishPointer = (type: "touchend" | "touchcancel", point: TouchPoint, event?: PointerEvent) => {
        if (pointerId === null) {
            return;
        }
        const dragged = isDragging;
        dispatchTouchEvent(type, point);
        resetPointer();
        if (dragged) {
            event?.preventDefault();
            suppressClick = true;
            setTimeout(() => {
                suppressClick = false;
            });
        }
    };

    element.addEventListener("pointerdown", (event: PointerEvent) => {
        if (event.pointerType !== "mouse" || event.button !== 0 || pointerId !== null) {
            return;
        }
        pointerId = event.pointerId;
        pointerTarget = event.target;
        lastPoint = event;
        captureElement = event.target instanceof Element ? event.target : element;
        captureElement.setPointerCapture(event.pointerId);
        dispatchTouchEvent("touchstart", event);
    });

    element.addEventListener("pointermove", (event: PointerEvent) => {
        if (pointerId !== event.pointerId) {
            return;
        }
        if ((event.buttons & 1) === 0) {
            finishPointer("touchend", event, event);
            return;
        }
        if (dispatchTouchEvent("touchmove", event)) {
            isDragging = true;
            event.preventDefault();
        }
    }, {passive: false});

    element.addEventListener("pointerup", (event: PointerEvent) => {
        if (pointerId === event.pointerId) {
            finishPointer("touchend", event, event);
        }
    }, {passive: false});

    element.addEventListener("pointercancel", (event: PointerEvent) => {
        if (pointerId === event.pointerId) {
            finishPointer("touchcancel", event);
        }
    });

    element.addEventListener("lostpointercapture", (event: PointerEvent) => {
        if (pointerId === event.pointerId) {
            finishPointer("touchcancel", lastPoint);
        }
    });

    element.addEventListener("click", (event) => {
        if (suppressClick) {
            event.preventDefault();
            event.stopImmediatePropagation();
            suppressClick = false;
        }
    }, {capture: true});

    const blockDuplicatedTouch = (event: TouchEvent) => {
        if (pointerId !== null && !isMousePointerTouchEvent(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    element.addEventListener("touchstart", blockDuplicatedTouch, {capture: true, passive: false});
    element.addEventListener("touchmove", blockDuplicatedTouch, {capture: true, passive: false});
    element.addEventListener("touchend", blockDuplicatedTouch, {capture: true, passive: false});
    element.addEventListener("touchcancel", blockDuplicatedTouch, {capture: true, passive: false});
};
