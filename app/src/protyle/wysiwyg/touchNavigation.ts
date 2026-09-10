import {Constants} from "../../constants";

export const bindTouchNavigation = (element: HTMLElement,
                                    onTap: (target: HTMLElement, point: {x: number, y: number}) => void) => {
    let start: {id: number, x: number, y: number, time: number, target: HTMLElement} | undefined;
    element.addEventListener("touchstart", (event: TouchEvent) => {
        start = undefined;
        const target = event.target as HTMLElement;
        if (event.defaultPrevented || event.touches.length !== 1 ||
            !target.closest('[contenteditable="true"]')) {
            return;
        }
        const touch = event.touches[0];
        start = {id: touch.identifier, x: touch.clientX, y: touch.clientY, time: Date.now(), target};
    }, {passive: true});
    element.addEventListener("touchmove", (event: TouchEvent) => {
        const touch = start && Array.from(event.touches).find(item => item.identifier === start.id);
        if (!touch || event.touches.length !== 1 ||
            Math.abs(touch.clientX - start.x) >= Constants.SIZE_DRAG_THRESHOLD ||
            Math.abs(touch.clientY - start.y) >= Constants.SIZE_DRAG_THRESHOLD) {
            start = undefined;
        }
    }, {passive: true});
    element.addEventListener("touchend", (event: TouchEvent) => {
        const tap = start;
        start = undefined;
        const touch = tap && Array.from(event.changedTouches).find(item => item.identifier === tap.id);
        // 原生触摸不一定合成点击事件，短按结束时直接记录；滚动、长按和多指手势不进入导航历史。
        if (!touch || event.defaultPrevented || event.touches.length > 0 ||
            Date.now() - tap.time >= Constants.TIMEOUT_LONGPRESS ||
            Math.abs(touch.clientX - tap.x) >= Constants.SIZE_DRAG_THRESHOLD ||
            Math.abs(touch.clientY - tap.y) >= Constants.SIZE_DRAG_THRESHOLD) {
            return;
        }
        onTap(tap.target, {x: touch.clientX, y: touch.clientY});
    }, {passive: true});
    element.addEventListener("touchcancel", () => {
        start = undefined;
    }, {passive: true});
};
