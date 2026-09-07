interface IMobileKeyboardChangeNotifierOptions {
    dispatch: (open: boolean) => void,
    setTimer?: (callback: () => void, delay: number) => number,
    clearTimer?: (timer: number) => void,
    closeDelay?: number,
}

// 等待系统软键盘关闭动画结束，避免底栏跟随仍在变化的视口向下移动。
export const MOBILE_KEYBOARD_CLOSE_DELAY = 300;

export const createMobileKeyboardChangeNotifier = (options: IMobileKeyboardChangeNotifierOptions) => {
    const setTimer = options.setTimer || ((callback, delay) => window.setTimeout(callback, delay));
    const clearTimer = options.clearTimer || ((timer) => window.clearTimeout(timer));
    const closeDelay = options.closeDelay ?? MOBILE_KEYBOARD_CLOSE_DELAY;
    let closeTimer: number | undefined;

    return (open: boolean) => {
        if (closeTimer !== undefined) {
            clearTimer(closeTimer);
            closeTimer = undefined;
        }
        if (open) {
            options.dispatch(true);
            return;
        }
        closeTimer = setTimer(() => {
            closeTimer = undefined;
            options.dispatch(false);
        }, closeDelay);
    };
};

export const notifyMobileKeyboardChange = createMobileKeyboardChangeNotifier({
    dispatch: (open) => window.dispatchEvent(new CustomEvent("siyuan-mobile-keyboard-change", {detail: open})),
});
