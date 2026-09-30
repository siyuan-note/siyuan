const foldedRenderRoots = new WeakSet<Element>();

export const registerFoldedRenderRoot = (root: Element) => foldedRenderRoots.add(root);

export const unregisterFoldedRenderRoot = (root: Element) => foldedRenderRoots.delete(root);

// 只延迟编辑器内折叠容器的组件初始化，导出和独立预览仍渲染完整内容。
export const isFoldedRenderContent = (element: Element, includeSelf = false) => {
    const root = element.closest(".protyle-wysiwyg");
    if (!root || !foldedRenderRoots.has(root)) {
        return false;
    }
    let child = element;
    let parent = includeSelf ? element : element.parentElement;
    while (parent && parent !== root) {
        if (parent.getAttribute("fold") === "1" && parent.hasAttribute("data-node-id") &&
            parent.getAttribute("data-type") !== "NodeHeading") {
            if (parent === element) {
                return true;
            }
            const type = parent.getAttribute("data-type");
            if (type === "NodeCallout" && child.classList.contains("callout-content") ||
                type === "NodeTabs" && child.classList.contains("tab-item")) {
                return true;
            }
            // 列表项和引述等容器保留首个子块作为摘要，摘要中的公式仍需渲染。
            if (["NodeListItem", "NodeMindmapItem", "NodeBlockquote", "NodeList", "NodeMindmap"].includes(type)) {
                const firstBlock = Array.from(parent.children).find(node => node.hasAttribute("data-node-id"));
                if (child !== firstBlock && (child.hasAttribute("data-node-id") || child.classList.contains("mindmap-view"))) {
                    return true;
                }
            }
        }
        child = parent;
        parent = parent.parentElement;
    }
    return false;
};
