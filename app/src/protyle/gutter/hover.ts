const pendingGutterHovers = new WeakMap<HTMLElement, number>();

export const cancelGutterHover = (element?: HTMLElement) => {
    if (!element) {
        return;
    }
    const timer = pendingGutterHovers.get(element);
    if (timer !== undefined) {
        window.clearTimeout(timer);
        pendingGutterHovers.delete(element);
    }
};

// 移向竖排块标时允许短暂经过相邻块，停留在新块上才切换整组块标。
export const renderGutterOnHover = (protyle: IProtyle, element: HTMLElement, target?: Element) => {
    const gutter = protyle.gutter;
    const gutterElement = gutter.element;
    cancelGutterHover(gutterElement);
    const vertical = !gutterElement.classList.contains("fn__none") &&
        gutterElement.classList.contains("protyle-gutters--full") && gutterElement.style.flexDirection === "column";
    const buttons = vertical ? Array.from(gutterElement.querySelectorAll<HTMLElement>("button[data-node-id]")) : [];
    const currentButton = buttons[buttons.length - 1];
    if (!currentButton || currentButton.dataset.nodeId === element.getAttribute("data-node-id")) {
        gutter.render(protyle, element, target);
        return;
    }
    const timer = window.setTimeout(() => {
        if (pendingGutterHovers.get(gutterElement) !== timer) {
            return;
        }
        pendingGutterHovers.delete(gutterElement);
        // 隐藏、切换文档或其他入口重绘块标后，不恢复过期的悬停目标。
        if (protyle.gutter === gutter && gutterElement.isConnected && element.isConnected &&
            !gutterElement.classList.contains("fn__none") && gutterElement.contains(currentButton) &&
            protyle.wysiwyg.element.contains(element)) {
            gutter.render(protyle, element, target);
        }
    }, 150);
    pendingGutterHovers.set(gutterElement, timer);
};
