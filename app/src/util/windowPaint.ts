const FRAME_WAIT_LIMIT = 250;

// 等主题样式加载完成并绘制窗口内容。
export const waitForWindowPaint = async (render: () => Promise<void>) => {
    const initialStyles = new Set(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'));
    const styles = new Map<HTMLLinkElement, () => void>();
    const pending: Promise<void>[] = [];
    const collectStyles = () => {
        document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach(style => {
            if (initialStyles.has(style) || style.sheet || styles.has(style) || style.disabled) return;
            pending.push(new Promise<void>(resolve => {
                const complete = () => {
                    style.removeEventListener("load", complete);
                    style.removeEventListener("error", complete);
                    resolve();
                };
                styles.set(style, complete);
                style.addEventListener("load", complete, {once: true});
                style.addEventListener("error", complete, {once: true});
            }));
        });
        styles.forEach((complete, style) => {
            if (!style.isConnected || style.disabled) complete();
        });
    };
    const observer = new MutationObserver(collectStyles);
    observer.observe(document.head, {childList: true});
    try {
        await render();
        collectStyles();
        await Promise.all(pending);
        await new Promise<void>(resolve => {
            let frame = 0;
            const finish = () => {
                window.clearTimeout(timer);
                cancelAnimationFrame(frame);
                resolve();
            };
            // 帧回调未及时执行时也允许完成初始化。
            const timer = window.setTimeout(finish, FRAME_WAIT_LIMIT);
            frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
        });
    } finally {
        observer.disconnect();
        styles.forEach(complete => complete());
    }
};
