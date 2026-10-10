// 列表项的首个容器保留独立块标，段落仍沿用列表项的合并操作。
export const getListItemGutterContainer = (element: Element) => {
    const item = element.closest('[data-type="NodeListItem"]');
    const first = item?.querySelector(":scope > [data-node-id]");
    if (first && ["NodeTable", "NodeBlockquote", "NodeCallout", "NodeSuperBlock", "NodeTabs"]
        .includes(first.getAttribute("data-type")) && (element === item || first.contains(element))) {
        return first;
    }
};

// 鼠标经过祖先容器留白移向子块块标时，保留当前块标及其选区。
export const isContainerGutterBridge = (gutter: HTMLElement, container: HTMLElement, target: HTMLElement,
                                       x: number, y: number, getBlock: (button: HTMLElement) => Element) => {
    if (gutter.classList.contains("fn__none") ||
        !["NodeBlockquote", "NodeCallout", "NodeSuperBlock", "NodeBlockQueryEmbed"].includes(container.dataset.type) ||
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
