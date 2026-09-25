export const waitForSheetViewport = (options: {
    height: () => number;
    fullHeight: number;
    now: () => number;
    requestFrame: (callback: () => void) => number;
    cancelFrame: (id: number) => void;
    open: () => void;
}) => {
    const start = options.now();
    const waitForKeyboard = options.fullHeight - options.height() > 100;
    let frame: number;
    let cancelled = false;
    let restoredAt: number | undefined;
    const check = () => {
        if (cancelled) {
            return;
        }
        const now = options.now();
        if (options.height() >= options.fullHeight - 2) {
            restoredAt ??= now;
        } else {
            restoredAt = undefined;
        }
        // 无键盘时下一帧展开；键盘收起后等待布局稳定，超时兼容浮动键盘和窗口尺寸变化。
        if (!waitForKeyboard || (restoredAt !== undefined && now - restoredAt >= 32) || now - start >= 1000) {
            options.open();
            return;
        }
        frame = options.requestFrame(check);
    };
    frame = options.requestFrame(check);
    return () => {
        cancelled = true;
        options.cancelFrame(frame);
    };
};

export const getVisibleSheetViewport = (layoutHeight: number, visualViewport?: {
    height: number;
    offsetTop: number;
}) => {
    const top = Math.max(0, Math.min(layoutHeight, visualViewport?.offsetTop ?? 0));
    const bottom = Math.max(top, Math.min(layoutHeight, (visualViewport?.offsetTop ?? 0) +
        (visualViewport?.height ?? layoutHeight)));
    return {
        height: bottom - top,
        bottomOffset: Math.max(0, layoutHeight - bottom),
    };
};
