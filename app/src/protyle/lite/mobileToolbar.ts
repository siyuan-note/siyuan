export const bindMobileToolbar = (protyle: IProtyle) => {
    let frame: number | undefined;
    const toolbar = protyle.toolbar;
    const viewport = window.visualViewport;
    const position = () => {
        const top = viewport?.offsetTop || 0;
        toolbar.element.style.left = `${viewport?.offsetLeft || 0}px`;
        toolbar.element.style.width = `${viewport?.width || window.innerWidth}px`;
        toolbar.element.style.top = `${Math.max(top, top + (viewport?.height || window.innerHeight) - toolbar.element.offsetHeight)}px`;
    };
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
            position();
            toolbar.element.style.zIndex = (++window.siyuan.zIndex).toString();
        });
    };
    const preventBlur = (event: MouseEvent) => event.preventDefault();
    // 工具栏固定在键盘上方，避开原生选区菜单，并脱离宿主的变换和裁剪边界。
    toolbar.element.setAttribute("data-position-boundary", "viewport");
    toolbar.element.classList.add("protyle-toolbar--mobile");
    document.body.appendChild(toolbar.element);
    toolbar.element.addEventListener("mousedown", preventBlur);
    document.addEventListener("selectionchange", render);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
        window.removeEventListener("resize", position);
        viewport?.removeEventListener("resize", position);
        viewport?.removeEventListener("scroll", position);
        document.removeEventListener("selectionchange", render);
        toolbar.element.removeEventListener("mousedown", preventBlur);
        toolbar.element.remove();
        if (frame !== undefined) {
            window.cancelAnimationFrame(frame);
        }
    };
};
