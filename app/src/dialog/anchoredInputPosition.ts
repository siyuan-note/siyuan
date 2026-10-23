import {isMobile} from "../util/functions";

export const bindAnchoredInputPosition = (inputElement: HTMLElement, getAnchor: () => HTMLElement,
                                         contentElement?: HTMLElement, fitContent = false) => {
    const maskElement = inputElement.parentElement;
    let frame = 0;
    let disposed = false;
    let observedAnchor: HTMLElement;
    // 分别记录用户设置的尺寸和当前显示尺寸，空间恢复后还原用户设置。
    let appliedWidth = "";
    let appliedHeight = "";
    let preferredSize: {width: number, height: number};
    const applySize = (width: number, height: number) => {
        inputElement.style.width = `${width}px`;
        inputElement.style.height = `${height}px`;
        appliedWidth = inputElement.style.width;
        appliedHeight = inputElement.style.height;
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
        if (appliedWidth &&
            (inputElement.style.width !== appliedWidth || inputElement.style.height !== appliedHeight)) {
            // 仅更新用户实际拖动的轴，避免将另一轴临时受限的尺寸记作用户设置。
            preferredSize = {
                width: inputElement.style.width !== appliedWidth ? parseFloat(inputElement.style.width) :
                    preferredSize?.width ?? parseFloat(appliedWidth),
                height: inputElement.style.height !== appliedHeight ? parseFloat(inputElement.style.height) :
                    preferredSize?.height ?? parseFloat(appliedHeight),
            };
        }
        const cellRect = anchorElement.getBoundingClientRect();
        const maskRect = maskElement.getBoundingClientRect();
        const contentRect = contentElement?.getBoundingClientRect();
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width ?? window.innerWidth;
        const viewportHeight = viewport?.height ?? window.innerHeight;
        if (fitContent) {
            const width = Math.min(preferredSize?.width ?? Math.max(cellRect.width, 240), Math.max(0, viewportWidth - 16));
            let height = preferredSize?.height;
            if (!preferredSize) {
                inputElement.style.width = `${width}px`;
                inputElement.style.height = "auto";
                height = Math.max(cellRect.height, inputElement.scrollHeight);
            }
            height = Math.min(height, Math.max(0, viewportHeight - 16));
            applySize(width, height);
            const left = Math.max(viewportLeft + 8, Math.min(cellRect.left, viewportLeft + viewportWidth - width - 8));
            const top = Math.max(viewportTop + 8, Math.min(cellRect.top, viewportTop + viewportHeight - height - 8));
            inputElement.style.left = `${left - maskRect.left}px`;
            inputElement.style.top = `${top - maskRect.top}px`;
            inputElement.style.visibility = "";
            return;
        }
        if (isMobile() && document.activeElement === inputElement) {
            // 键盘动画期间视觉视口可能先缩小再恢复；隐藏聚焦控件会使 WebView 失焦并收起键盘。
            // 保留同一个输入框和草稿，将其移入可见视口，空间恢复后重新对齐单元格。
            if (viewportWidth <= 0 || viewportHeight <= 0) {
                return;
            }
            const width = Math.min(preferredSize?.width ?? Math.max(cellRect.width, 25), viewportWidth);
            const height = Math.min(preferredSize?.height ?? cellRect.height, viewportHeight);
            const left = Math.max(viewportLeft, Math.min(cellRect.left, viewportLeft + viewportWidth - width));
            const top = Math.max(viewportTop, Math.min(cellRect.top, viewportTop + viewportHeight - height));
            inputElement.style.left = `${left - maskRect.left}px`;
            inputElement.style.top = `${top - maskRect.top}px`;
            applySize(width, height);
            inputElement.style.visibility = "";
            return;
        }
        const visibleLeft = Math.max(viewportLeft, contentRect?.left ?? viewportLeft);
        const visibleTop = Math.max(viewportTop, contentRect?.top ?? viewportTop);
        const visibleRight = Math.min(viewportLeft + viewportWidth, contentRect?.right ?? viewportLeft + viewportWidth);
        const visibleBottom = Math.min(viewportTop + viewportHeight, contentRect?.bottom ?? viewportTop + viewportHeight);
        const left = Math.max(cellRect.left, visibleLeft);
        const top = Math.max(cellRect.top, visibleTop);
        const width = Math.min(preferredSize?.width ?? Math.max(cellRect.width, 25), Math.max(0, visibleRight - left));
        const height = Math.max(0, Math.min(preferredSize?.height ?? cellRect.bottom - top, visibleBottom - top));
        // 输入框位于独立遮罩中，使用当前单元格坐标并扣除遮罩原点，保持滚动和视口变化后的对齐。
        inputElement.style.top = `${top - maskRect.top}px`;
        inputElement.style.left = `${left - maskRect.left}px`;
        applySize(width, height);
        inputElement.style.visibility = width > 0 && height > 0 && cellRect.right > visibleLeft &&
            cellRect.bottom > visibleTop ? "" : "hidden";
    };
    const schedule = () => {
        if (!disposed && !frame) {
            frame = window.requestAnimationFrame(update);
        }
    };
    const viewport = window.visualViewport;
    const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
    resizeObserver?.observe(inputElement);
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
