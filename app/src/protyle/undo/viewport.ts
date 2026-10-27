const preservedViewports = new WeakMap<Element, number>();

export const isUndoViewportPreserved = (root: Element) => preservedViewports.has(root);

// 画布历史只回放内容和选择，不按正文光标或历史节点重新定位视口。
export const preserveUndoViewport = (root: Element) => {
    preservedViewports.set(root, (preservedViewports.get(root) || 0) + 1);
    let active = true;
    return () => {
        if (!active) {
            return;
        }
        active = false;
        const remaining = (preservedViewports.get(root) || 1) - 1;
        if (remaining) {
            preservedViewports.set(root, remaining);
        } else {
            preservedViewports.delete(root);
        }
    };
};
