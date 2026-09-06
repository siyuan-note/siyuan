// 鼠标从页签正文移向块标时保留当前块标，避免经过容器留白触发隐藏或切换。
export const isTabGutterBridge = (root: HTMLElement, gutter: HTMLElement, target: HTMLElement,
                                 x: number, y: number) => {
    if (gutter.classList.contains("fn__none") || target.closest(".tabs-header") || !root.contains(target)) {
        return false;
    }
    const buttons = Array.from(gutter.querySelectorAll<HTMLElement>("button[data-node-id]"));
    const button = buttons.reverse().find(item => item.dataset.type !== "NodeTabItem" && item.dataset.type !== "fold");
    if (!button) {
        return false;
    }
    const block = root.querySelector<HTMLElement>(`[data-node-id="${button.dataset.nodeId}"]`);
    const panel = block?.closest(".tab-item");
    if (!panel || !panel.parentElement.contains(target) || !block.closest(".tab-item-content")) {
        return false;
    }
    const blockRect = block.getBoundingClientRect();
    const gutterRect = gutter.getBoundingClientRect();
    return x >= gutterRect.left && x <= blockRect.left &&
        y >= Math.min(blockRect.top, gutterRect.top) && y <= Math.max(blockRect.bottom, gutterRect.bottom);
};
