const FRAME_WAIT_LIMIT = 250;
const STYLESHEET_WAIT_LIMIT = 5000;

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
        if (pending.length) {
            // 样式请求无响应时仍允许显示窗口，迟到的样式继续由浏览器加载。
            const timer = window.setTimeout(() => {
                styles.forEach(complete => complete());
                console.warn("Timed out waiting for window stylesheets");
            }, STYLESHEET_WAIT_LIMIT);
            try {
                await Promise.all(pending);
            } finally {
                window.clearTimeout(timer);
            }
        }
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
