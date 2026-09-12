import {getBlockDragSelectContentBounds} from "./blockDragSelect";

// 平板桌面布局的侧边触摸复用鼠标框选，正文内仍由浏览器处理滚动和文字选择。
export const bindTouchBlockDragSelect = (element: HTMLElement, canStart: () => boolean) => {
    let activeTouch: Touch | undefined;
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
        if (!activeTouch) {
            return;
        }
        const touch = Array.from(event.changedTouches).find(item => item.identifier === activeTouch.identifier) ||
            activeTouch;
        activeTouch = undefined;
        dispatchMouse("mouseup", touch);
        startTarget = undefined;
        event.preventDefault();
        event.stopPropagation();
    };
    element.addEventListener("touchstart", (event: TouchEvent) => {
        if (activeTouch) {
            finish(event);
            return;
        }
        const target = event.target as HTMLElement;
        if (event.touches.length !== 1 || !canStart() || target.closest(".protyle-wysiwyg") !== element ||
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
        activeTouch = touch;
        startTarget = target;
        contentBounds = bounds;
        dispatchMouse("mousedown", touch);
        event.preventDefault();
        event.stopPropagation();
    }, {passive: false});
    element.addEventListener("touchmove", (event: TouchEvent) => {
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
    }, {passive: false});
    element.addEventListener("touchend", finish, {passive: false});
    element.addEventListener("touchcancel", finish, {passive: false});
};
