// 尺寸把手属于派生界面，沿用编辑器动作类以避免写入 iframe 正文。
export const renderIFrameResize = (root: Element) => {
    const selector = '[data-type="NodeIFrame"], [data-type="NodeWidget"]';
    const blocks = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (root.matches(selector)) {
        blocks.unshift(root as HTMLElement);
    }
    blocks.forEach(block => {
        if (!block.closest(".protyle-wysiwyg") || block.closest(".mindmap-view__preview-block, .protyle-wysiwyg__embed")) {
            return;
        }
        const content = block.querySelector<HTMLElement>(":scope > .iframe-content");
        if (!content?.querySelector(":scope > iframe")) {
            return;
        }
        for (const axis of ["both", "width", "height"]) {
            let handle = content.querySelector<HTMLElement>(`.protyle-action__drag[data-resize-axis="${axis}"]`);
            if (!handle && axis === "both") {
                handle = content.querySelector<HTMLElement>(".protyle-action__drag:not([data-resize-axis])");
            }
            if (!handle) {
                handle = block.ownerDocument.createElement("span");
                content.appendChild(handle);
            }
            handle.className = "protyle-action__drag protyle-block-resize";
            handle.contentEditable = "false";
            handle.dataset.resizeAxis = axis;
            handle.setAttribute("data-prevent-swipe", "true");
        }
    });
};
