// 鼠标经过祖先容器留白移向子块块标时，保留当前块标及其选区。
export const isContainerGutterBridge = (gutter: HTMLElement, container: HTMLElement, target: HTMLElement,
                                       x: number, y: number, getBlock: (button: HTMLElement) => Element) => {
    if (gutter.classList.contains("fn__none") ||
        !["NodeBlockquote", "NodeCallout", "NodeSuperBlock"].includes(container.dataset.type) ||
        target.closest(".callout-info")) {
        return false;
    }
    const gutterRect = gutter.getBoundingClientRect();
    return Array.from(gutter.querySelectorAll<HTMLElement>("button[data-node-id]")).some(button => {
        if (button.dataset.type === "fold") {
            return false;
        }
        const block = getBlock(button);
        if (!block || block === container || !container.contains(block)) {
            return false;
        }
        const blockRect = block.getBoundingClientRect();
        return x >= gutterRect.left && x <= blockRect.left &&
            y >= Math.min(blockRect.top, gutterRect.top) && y <= Math.max(blockRect.bottom, gutterRect.bottom);
    });
};
