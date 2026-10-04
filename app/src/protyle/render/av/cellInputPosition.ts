export const bindAVCellInputPosition = (inputElement: HTMLElement, getAnchor: () => HTMLElement,
                                       contentElement?: HTMLElement) => {
    const maskElement = inputElement.parentElement;
    let frame = 0;
    let disposed = false;
    let observedAnchor: HTMLElement;
    const update = () => {
        frame = 0;
        const anchorElement = getAnchor();
        if (!maskElement.isConnected) {
            dispose();
            return;
        }
        if (!anchorElement?.isConnected) {
            inputElement.style.visibility = "hidden";
            return;
        }
        if (observedAnchor !== anchorElement) {
            if (observedAnchor) {
                resizeObserver?.unobserve(observedAnchor);
            }
            resizeObserver?.observe(anchorElement);
            observedAnchor = anchorElement;
        }
        const cellRect = anchorElement.getBoundingClientRect();
        const maskRect = maskElement.getBoundingClientRect();
        const contentRect = contentElement?.getBoundingClientRect();
        const width = contentRect ? Math.min(Math.max(cellRect.width, 25), contentRect.width) :
            Math.max(cellRect.width, 25);
        const left = contentRect && (cellRect.left < contentRect.left || cellRect.left + width > contentRect.right) ?
            contentRect.left : cellRect.left;
        const height = contentRect ? Math.max(0, Math.min(cellRect.bottom, contentRect.bottom) - cellRect.top) :
            cellRect.height;
        // 输入框位于独立遮罩中，使用当前单元格坐标并扣除遮罩原点，保持滚动和视口变化后的对齐。
        inputElement.style.top = `${cellRect.top - maskRect.top}px`;
        inputElement.style.left = `${left - maskRect.left}px`;
        inputElement.style.width = `${width}px`;
        inputElement.style.height = `${height}px`;
        inputElement.style.visibility = height > 0 ? "" : "hidden";
    };
    const schedule = () => {
        if (!disposed && !frame) {
            frame = window.requestAnimationFrame(update);
        }
    };
    const viewport = window.visualViewport;
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    if (contentElement) {
        resizeObserver?.observe(contentElement);
    }
    // 固定表头占位和行重绘也会改变单元格位置；遮罩移除时统一释放所有监听。
    const ownerObserver = new MutationObserver(() => {
        if (!maskElement.isConnected) {
            dispose();
        } else {
            schedule();
        }
    });
    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        window.cancelAnimationFrame(frame);
        frame = 0;
        resizeObserver?.disconnect();
        ownerObserver.disconnect();
        window.removeEventListener("scroll", schedule, true);
        window.removeEventListener("resize", schedule);
        viewport?.removeEventListener("resize", schedule);
        viewport?.removeEventListener("scroll", schedule);
    };
    window.addEventListener("scroll", schedule, {capture: true, passive: true});
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    ownerObserver.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
    update();
    // 焦点及键盘桥接调用结束后再次测量，避免沿用聚焦前的布局位置。
    schedule();
    return dispose;
};
