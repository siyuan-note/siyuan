import {Constants} from "../../constants";
import {cancelTouchDragCandidate} from "../../util/touchDragBridge";
import {getBlockDragSelectContentBounds} from "./blockDragSelect";

// 平板桌面布局的侧边触摸复用鼠标框选，正文内仍由浏览器处理滚动和文字选择。
export const bindTouchBlockDragSelect = (element: HTMLElement, canStart: () => boolean,
                                        host: HTMLElement = element) => {
    let pending: {touch: Touch, time: number, target: HTMLElement} | undefined;
    let activeTouch: Touch | undefined;
    let releaseGutter: (() => void) | undefined;
    let startTarget: HTMLElement | undefined;
    let contentBounds: { left: number, right: number };
    const dispatchMouse = (type: string, touch: Touch) => {
        // 沿侧边上下滑动时，将框选终点投影到正文边界，保证选区能命中块。
        const clientX = type === "mousemove" ?
            Math.max(contentBounds.left, Math.min(touch.clientX, contentBounds.right)) : touch.clientX;
        const target = type === "mousedown" ? startTarget :
            document.elementFromPoint(clientX, touch.clientY) || element;
        target.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: type === "mouseup" ? 0 : 1,
            clientX,
            clientY: touch.clientY,
        }));
    };
    const finish = (event: TouchEvent) => {
        pending = undefined;
        if (!activeTouch) {
            return;
        }
        const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTouch.identifier) ||
            activeTouch;
        activeTouch = undefined;
        const release = releaseGutter;
        releaseGutter = undefined;
        release?.();
        dispatchMouse("mouseup", touch);
        startTarget = undefined;
        event.preventDefault();
        event.stopPropagation();
    };
    const touchStart = (event: TouchEvent) => {
        pending = undefined;
        if (activeTouch) {
            finish(event);
            return;
        }
        const target = event.target as HTMLElement;
        const gutter = target.closest(".protyle-gutters");
        const fromGutter = !!gutter && target.closest(".protyle") === host &&
            !!element.querySelector(".protyle-wysiwyg--select");
        if (event.defaultPrevented || event.touches.length !== 1 || !canStart() ||
            (target.closest(".protyle-wysiwyg") !== element && !fromGutter) ||
            element.closest(".sy__backlink--bottom")) {
            return;
        }
        const touch = event.touches[0];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const bounds = getBlockDragSelectContentBounds(rect.left, rect.right, style.paddingLeft, style.paddingRight);
        if (touch.clientX >= bounds.left - 1 && touch.clientX <= bounds.right + 2) {
            return;
        }
        if (fromGutter) {
            // 块标短按打开菜单，长按交给拖块；越过位移阈值的短拖动才开始重新划选。
            pending = {touch, time: event.timeStamp, target};
            contentBounds = bounds;
            return;
        }
        activeTouch = touch;
        startTarget = target;
        contentBounds = bounds;
        dispatchMouse("mousedown", touch);
        event.preventDefault();
        event.stopPropagation();
    };
    const touchMove = (event: TouchEvent) => {
        if (pending) {
            const start = pending;
            const touch = Array.from(event.touches).find(item => item.identifier === start.touch.identifier);
            if (event.defaultPrevented || !touch || event.touches.length !== 1 || !canStart() ||
                event.timeStamp - start.time >= Constants.TIMEOUT_LONGPRESS) {
                pending = undefined;
                return;
            }
            if (Math.abs(touch.clientX - start.touch.clientX) < Constants.SIZE_DRAG_THRESHOLD &&
                Math.abs(touch.clientY - start.touch.clientY) < Constants.SIZE_DRAG_THRESHOLD) {
                return;
            }
            pending = undefined;
            const release = cancelTouchDragCandidate(start.target);
            if (!release) {
                return;
            }
            releaseGutter = release;
            activeTouch = start.touch;
            startTarget = element;
            dispatchMouse("mousedown", start.touch);
        }
        if (!activeTouch) {
            return;
        }
        const touch = Array.from(event.touches).find(item => item.identifier === activeTouch.identifier);
        if (!touch || event.touches.length !== 1) {
            finish(event);
            return;
        }
        activeTouch = touch;
        dispatchMouse("mousemove", touch);
        event.preventDefault();
        event.stopPropagation();
    };
    host.addEventListener("touchstart", touchStart, {passive: false});
    host.addEventListener("touchmove", touchMove, {passive: false});
    host.addEventListener("touchend", finish, {passive: false});
    host.addEventListener("touchcancel", finish, {passive: false});
    return () => {
        if (pending) {
            const release = cancelTouchDragCandidate(pending.target);
            if (release) release();
        }
        pending = undefined;
        const touch = activeTouch;
        activeTouch = undefined;
        const release = releaseGutter;
        releaseGutter = undefined;
        release?.();
        if (touch) {
            dispatchMouse("mouseup", touch);
        }
        activeTouch = undefined;
        startTarget = undefined;
        host.removeEventListener("touchstart", touchStart);
        host.removeEventListener("touchmove", touchMove);
        host.removeEventListener("touchend", finish);
        host.removeEventListener("touchcancel", finish);
    };
};
