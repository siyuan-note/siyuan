export const bindPanelTransitionGuard = (element: HTMLElement, isEnabled = () => true) => {
    let blockedPress = false;
    const isMoving = () => isEnabled() && element.getAnimations().some(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === "transform" &&
        (animation.playState === "running" || animation.pending));
    const cancel = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const startPress = (event: Event) => {
        blockedPress = isMoving();
        if (blockedPress) {
            cancel(event);
        }
    };
    element.addEventListener("pointerdown", startPress, true);
    element.addEventListener("touchstart", startPress, {capture: true, passive: false});
    const activate = (event: MouseEvent) => {
        if (!(event instanceof MouseEvent)) {
            return;
        }
        if (!isEnabled()) {
            blockedPress = false;
            return;
        }
        const moving = isMoving();
        // 动画期间开始的按压不激活条目，延迟到达的点击保留到下一次按压前拦截。
        if (!moving && (!blockedPress || event.detail === 0)) {
            return;
        }
        blockedPress = true;
        cancel(event);
    };
    ["mousedown", "mouseup", "click", "dblclick", "contextmenu"].forEach(type => {
        element.addEventListener(type, activate, true);
    });
};
