// iPad 的鼠标悬停转为触摸前会先报告无坐标离开，保留短暂切换期间的点击目标。
export const bindGutterPointerLeave = (body: HTMLElement, leave: () => void, deferUnpositionedLeave: boolean) => {
    const ownerDocument = body.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    let timeout: number;
    const cancel = () => {
        ownerWindow.clearTimeout(timeout);
        timeout = undefined;
    };
    body.addEventListener("pointerleave", (event: PointerEvent) => {
        if (event.pointerType !== "mouse") {
            return;
        }
        cancel();
        if (deferUnpositionedLeave && event.clientX < 0 && event.clientY < 0) {
            timeout = ownerWindow.setTimeout(leave, 100);
        } else {
            leave();
        }
    });
    ownerDocument.addEventListener("pointerdown", cancel, {capture: true, passive: true});
    body.addEventListener("pointerenter", cancel, {passive: true});
};
