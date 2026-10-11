export const bindAnchoredInputPosition = (inputElement: HTMLElement, getAnchor: () => HTMLElement,
                                         contentElement?: HTMLElement, fitContent = false) => {
    const maskElement = inputElement.parentElement;
    let frame = 0;
    let disposed = false;
    let observedAnchor: HTMLElement;
    // 记录最近一次写入的尺寸；内联尺寸与之不同说明用户拖拽调整过大小，此后仅更新位置
    let appliedWidth = "";
    let appliedHeight = "";
    let keepSize = false;
    const applySize = (width: number, height: number) => {
        appliedWidth = `${width}px`;
        appliedHeight = `${height}px`;
        inputElement.style.width = appliedWidth;
        inputElement.style.height = appliedHeight;
    };
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
        if (!keepSize && appliedWidth &&
            (inputElement.style.width !== appliedWidth || inputElement.style.height !== appliedHeight)) {
            keepSize = true;
        }
        const cellRect = anchorElement.getBoundingClientRect();
        const maskRect = maskElement.getBoundingClientRect();
        const contentRect = contentElement?.getBoundingClientRect();
        if (fitContent) {
            const viewport = window.visualViewport;
            const viewportLeft = viewport?.offsetLeft || 0;
            const viewportTop = viewport?.offsetTop || 0;
            const viewportWidth = viewport?.width || window.innerWidth;
            const viewportHeight = viewport?.height || window.innerHeight;
            let width = parseFloat(inputElement.style.width);
            let height = parseFloat(inputElement.style.height);
            if (!keepSize) {
                width = Math.min(Math.max(cellRect.width, 240), Math.max(0, viewportWidth - 16));
                inputElement.style.width = `${width}px`;
                inputElement.style.height = "auto";
                height = Math.min(Math.max(cellRect.height, inputElement.scrollHeight), Math.max(0, viewportHeight - 16));
                applySize(width, height);
            }
            const left = Math.max(viewportLeft + 8, Math.min(cellRect.left, viewportLeft + viewportWidth - width - 8));
            const top = Math.max(viewportTop + 8, Math.min(cellRect.top, viewportTop + viewportHeight - height - 8));
            inputElement.style.left = `${left - maskRect.left}px`;
            inputElement.style.top = `${top - maskRect.top}px`;
            inputElement.style.visibility = "";
            return;
        }
        const width = keepSize ? parseFloat(inputElement.style.width) :
            contentRect ? Math.min(Math.max(cellRect.width, 25), contentRect.width) : Math.max(cellRect.width, 25);
        const left = contentRect && (cellRect.left < contentRect.left || cellRect.left + width > contentRect.right) ?
            contentRect.left : cellRect.left;
        const height = contentRect ? Math.max(0, Math.min(cellRect.bottom, contentRect.bottom) - cellRect.top) :
            cellRect.height;
        // 输入框位于独立遮罩中，使用当前单元格坐标并扣除遮罩原点，保持滚动和视口变化后的对齐。
        inputElement.style.top = `${cellRect.top - maskRect.top}px`;
        inputElement.style.left = `${left - maskRect.left}px`;
        if (!keepSize) {
            applySize(width, height);
        }
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
        if (fitContent) {
            inputElement.removeEventListener("input", schedule);
        }
    };
    window.addEventListener("scroll", schedule, {capture: true, passive: true});
    window.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    if (fitContent) {
        inputElement.addEventListener("input", schedule);
    }
    ownerObserver.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ["class"]});
    update();
    // 焦点及键盘桥接调用结束后再次测量，避免沿用聚焦前的布局位置。
    schedule();
    return dispose;
};
