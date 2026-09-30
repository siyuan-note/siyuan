const foldedRenderRoots = new WeakSet<Element>();

export const registerFoldedRenderRoot = (root: Element) => foldedRenderRoots.add(root);

export const unregisterFoldedRenderRoot = (root: Element) => foldedRenderRoots.delete(root);

// 只延迟编辑器内折叠容器的组件初始化，导出和独立预览仍渲染完整内容。
export const isFoldedRenderContent = (element: Element, includeSelf = false) => {
    const root = element.closest(".protyle-wysiwyg");
    if (!root || !foldedRenderRoots.has(root)) {
        return false;
    }
    let parent = includeSelf ? element : element.parentElement;
    while (parent && parent !== root) {
        if (parent.getAttribute("fold") === "1" && parent.hasAttribute("data-node-id") &&
            parent.getAttribute("data-type") !== "NodeHeading") {
            return true;
        }
        parent = parent.parentElement;
    }
    return false;
};
