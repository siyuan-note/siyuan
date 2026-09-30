// 等主题样式和设置内容绘制完成，再通知主进程显示原生窗口。
export const waitForSettingsWindowPaint = async (render: () => Promise<void>) => {
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
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    } finally {
        observer.disconnect();
        styles.forEach(complete => complete());
    }
};
