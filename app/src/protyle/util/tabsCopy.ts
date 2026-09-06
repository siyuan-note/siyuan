// 同时映射页签选择和正文、标题中的内部链接，外部引用继续指向原目标。
export const remapTabsDOMIDs = (root: Element, ids: Map<string, string>) => {
    const blocks = [root, ...Array.from(root.querySelectorAll("[tabs-active-id]"))];
    blocks.forEach(group => {
        const active = group.getAttribute("tabs-active-id");
        if (ids.has(active)) {
            group.setAttribute("tabs-active-id", ids.get(active));
        }
    });
    root.querySelectorAll<HTMLElement>('[data-type~="block-ref"], [data-type~="a"]').forEach(link => {
        if (!link.closest(".tab-item")) {
            return;
        }
        if (ids.has(link.dataset.id)) {
            link.dataset.id = ids.get(link.dataset.id);
        }
        const href = link.dataset.href;
        if (href?.startsWith("siyuan://blocks/")) {
            const id = href.substring("siyuan://blocks/".length);
            if (ids.has(id)) {
                link.dataset.href = "siyuan://blocks/" + ids.get(id);
            }
        }
    });
};

// 独立页签项粘贴到普通正文时补齐容器，保持原页签和正文完整。
export const wrapPastedTabItems = (root: Element, lute: Lute) => {
    root.querySelectorAll<HTMLElement>('[data-type="NodeTabItem"]').forEach(item => {
        if (item.parentElement?.getAttribute("data-type") === "NodeTabs") {
            return;
        }
        const template = document.createElement("template");
        template.innerHTML = lute.Md2BlockDOM("::: tabs\n@tab\n\n:::\n");
        const tabs = template.content.firstElementChild;
        tabs.querySelector(":scope > .tab-item").remove();
        item.before(tabs);
        let next: Element = item;
        while (next?.getAttribute("data-type") === "NodeTabItem") {
            const sibling = next.nextElementSibling;
            tabs.insertBefore(next, tabs.querySelector(":scope > .protyle-attr"));
            next = sibling;
        }
        tabs.setAttribute("tabs-active-id", item.dataset.nodeId);
    });
};
