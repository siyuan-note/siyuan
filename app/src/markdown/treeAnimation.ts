// 与文档面板保持一致；子树按虚拟行范围分组，不为动画挂载屏幕外的文件。
export const animateMarkdownTreeRows = (list: HTMLElement, start: number, count: number, opening: boolean, rowHeight: number,
                                       snapshot: Array<{position: number; element: HTMLElement}>) => {
    if (!count || typeof list.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const group = document.createElement("div");
    group.className = "markdown-tree__animation";
    group.setAttribute("role", "presentation");
    if (opening) {
        let position = 0;
        for (const child of Array.from(list.children) as HTMLElement[]) {
            const size = child.dataset.treeSpacer ? Math.round(parseFloat(child.style.height) / rowHeight) : 1;
            const overlap = Math.max(0, Math.min(position + size, start + count) - Math.max(position, start));
            if (overlap) {
                if (position < start) {
                    const before = child.cloneNode() as HTMLElement;
                    before.style.height = `${(start - position) * rowHeight}px`;
                    child.before(before);
                }
                if (position + size > start + count) {
                    const after = child.cloneNode() as HTMLElement;
                    after.style.height = `${(position + size - start - count) * rowHeight}px`;
                    child.after(after);
                }
                if (!group.isConnected) child.before(group);
                if (child.dataset.treeSpacer) child.style.height = `${overlap * rowHeight}px`;
                group.append(child);
            }
            position += size;
        }
    } else {
        const parent = list.querySelector<HTMLElement>(`[data-row="${start - 1}"]`);
        if (!parent) return;
        group.inert = true;
        group.setAttribute("aria-hidden", "true");
        group.style.pointerEvents = "none";
        group.style.position = "relative";
        for (const child of snapshot) {
            // 退场快照只负责绘制，不能留下重复 ID 或可激活的旧文件节点。
            for (const item of [child.element, ...Array.from(child.element.querySelectorAll<HTMLElement>("*"))]) {
                item.removeAttribute("id");
                item.removeAttribute("data-row");
                item.removeAttribute("data-node-id");
                item.removeAttribute("data-retry");
            }
            child.element.style.position = "absolute";
            child.element.style.top = `${(child.position - start) * rowHeight}px`;
            child.element.style.left = "0";
            child.element.style.right = "0";
            group.append(child.element);
        }
        parent.after(group);
    }
    if (!group.isConnected) return;
    const height = count * rowHeight;
    const animation = group.animate([{height: `${opening ? 0 : height}px`}, {height: `${opening ? height : 0}px`}],
        {duration: 200, easing: "cubic-bezier(0, 0, .2, 1)"});
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        motion.removeEventListener("change", finish);
        animation.cancel();
        if (opening) group.replaceWith(...Array.from(group.children));
        else group.remove();
    };
    motion.addEventListener("change", finish);
    animation.onfinish = finish;
    animation.oncancel = finish;
    return finish;
};
