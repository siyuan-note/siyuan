export const bindMobileToolbar = (protyle: IProtyle) => {
    let frame: number | undefined;
    const toolbar = protyle.toolbar;
    const render = () => {
        if (frame !== undefined) {
            return;
        }
        frame = window.requestAnimationFrame(() => {
            frame = undefined;
            if (toolbar.subElement.contains(document.activeElement)) {
                return;
            }
            const selection = window.getSelection();
            const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
            const belongsToEditor = (node: Node) =>
                (node.nodeType === 1 ? node as Element : node.parentElement)?.closest(".protyle-wysiwyg") ===
                protyle.wysiwyg.element;
            if (!range || selection.isCollapsed || !belongsToEditor(range.startContainer) ||
                !belongsToEditor(range.endContainer)) {
                toolbar.element.classList.add("fn__none");
                return;
            }
            toolbar.render(protyle, range);
        });
    };
    const preventBlur = (event: MouseEvent) => event.preventDefault();
    // 片段编辑器使用自身的选区工具栏，格式操作和选区不交给下层文档。
    toolbar.element.setAttribute("data-position-boundary", "viewport");
    toolbar.element.style.maxWidth = "calc(100vw - 16px)";
    toolbar.element.style.flexWrap = "wrap";
    toolbar.element.addEventListener("mousedown", preventBlur);
    document.addEventListener("selectionchange", render);
    return () => {
        document.removeEventListener("selectionchange", render);
        toolbar.element.removeEventListener("mousedown", preventBlur);
        if (frame !== undefined) {
            window.cancelAnimationFrame(frame);
        }
    };
};
