const cleanups = new WeakMap<Element, () => void>();

// 重复挂载或面板移除时清理轮询和观察器。
export const startMountedPolling = (block: Element, render: () => void, interval = 3000) => {
    cleanups.get(block)?.();
    const timer = window.setInterval(render, interval);
    const cleanup = () => {
        window.clearInterval(timer);
        observer.disconnect();
        cleanups.delete(block);
    };
    const observer = new MutationObserver(() => {
        if (!block.isConnected) {
            cleanup();
        }
    });
    observer.observe(document.body, {childList: true, subtree: true});
    cleanups.set(block, cleanup);
    render();
};
