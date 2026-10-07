export interface IKeyboardSelectionScrollState {
    container: HTMLElement;
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
    viewportTop: number;
    viewportBottom: number;
}

interface IKeyboardSelectionScrollOptions {
    delay: number;
    scroll: (container: HTMLElement) => boolean;
    onCancel: () => void;
    setTimer?: (callback: () => void, delay: number) => number;
    clearTimer?: (timer: number) => void;
}

const sameSelection = (a: IKeyboardSelectionScrollState, b: IKeyboardSelectionScrollState) =>
    a?.container === b.container && a.anchorNode === b.anchorNode && a.anchorOffset === b.anchorOffset &&
    a.focusNode === b.focusNode && a.focusOffset === b.focusOffset;

const sameState = (a: IKeyboardSelectionScrollState, b: IKeyboardSelectionScrollState) =>
    sameSelection(a, b) && a.viewportTop === b.viewportTop && a.viewportBottom === b.viewportBottom;

export const createKeyboardSelectionScroll = (options: IKeyboardSelectionScrollOptions) => {
    const setTimer = options.setTimer || ((callback, delay) => window.setTimeout(callback, delay));
    const clearTimer = options.clearTimer || (timer => window.clearTimeout(timer));
    let state: IKeyboardSelectionScrollState;
    let touchState: IKeyboardSelectionScrollState;
    let timer: number | undefined;
    let stopTimer: number | undefined;
    let container: HTMLElement;
    let touching = false;
    let moved = false;
    let deferred = false;
    let scrolling = false;

    const cancelPending = () => {
        if (timer !== undefined) {
            clearTimer(timer);
            timer = undefined;
        }
        deferred = false;
    };
    const finishScroll = () => {
        scrolling = false;
        if (stopTimer !== undefined) {
            clearTimer(stopTimer);
            stopTimer = undefined;
        }
    };
    const cancel = () => {
        cancelPending();
        if (scrolling) {
            container.scroll({top: container.scrollTop, left: container.scrollLeft, behavior: "auto"});
        }
        finishScroll();
        options.onCancel();
    };
    const schedule = () => {
        timer = setTimer(() => {
            timer = undefined;
            finishScroll();
            scrolling = options.scroll(container);
            if (scrolling) {
                stopTimer = setTimer(finishScroll, 1000);
            }
        }, options.delay);
    };
    const touchStart = () => {
        cancel();
        touching = true;
        moved = false;
        touchState = state;
    };
    const touchMove = () => {
        moved = true;
        cancel();
    };
    const touchEnd = () => {
        touching = false;
        // 滑动仅浏览内容时保留视口；拖动选区端点后仍定位到新的选区。
        if ((deferred && !moved) || (state && touchState && !sameSelection(touchState, state))) {
            schedule();
        }
        deferred = false;
        touchState = undefined;
    };
    const touchCancel = () => {
        touching = false;
        touchState = undefined;
        cancel();
    };
    const pointerDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse") {
            cancel();
        }
    };
    const listeners: Array<[string, EventListener]> = [
        ["touchstart", touchStart], ["touchmove", touchMove], ["touchend", touchEnd],
        ["touchcancel", touchCancel], ["wheel", cancel], ["pointerdown", pointerDown],
        ["scrollend", finishScroll],
    ];
    const reset = () => {
        cancel();
        listeners.forEach(([type, listener]) => container?.removeEventListener(type, listener));
        container = undefined;
        state = undefined;
        touching = false;
        moved = false;
        touchState = undefined;
    };
    return {
        request: (nextState: IKeyboardSelectionScrollState, force = false) => {
            if (container !== nextState.container) {
                reset();
                container = nextState.container;
                listeners.forEach(([type, listener]) => container.addEventListener(type, listener, {passive: true}));
            }
            // 记录已处理的选区与视口，手动滚动后重复刷新工具栏不会再次定位。
            if (!force && sameState(state, nextState)) {
                return;
            }
            state = {...nextState};
            cancelPending();
            if (touching) {
                deferred = !moved;
                return;
            }
            schedule();
        },
        reset,
    };
};
