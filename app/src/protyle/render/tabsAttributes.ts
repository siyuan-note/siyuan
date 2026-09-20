interface ITabsAttributesOptions {
    label: string;
    open: (block: HTMLElement, focus: string) => void;
}

export const clearTabsAttributes = (root: Element, owns: (element: Element) => boolean = () => true) => {
    Array.from(root.querySelectorAll(".tabs-attributes")).filter(owns).forEach(button => button.remove());
    Array.from(root.querySelectorAll("[data-tabs-attributes]")).filter(owns)
        .forEach(block => block.removeAttribute("data-tabs-attributes"));
};

// 属性控件仅投影原始属性，保留块内属性节点供事务、复制及导出读取。
export const renderTabsAttributes = (tabs: HTMLElement, item: HTMLElement, header: HTMLElement,
                                     options?: ITabsAttributesOptions) => {
    if (!options || tabs.dataset.tabsOrientation !== "horizontal") {
        return;
    }
    const render = (block: HTMLElement) => {
        const source = block?.querySelector(":scope > .protyle-attr");
        const attrs = source && Array.from(source.children).filter(attr =>
            !attr.classList.contains("protyle-attr--refcount"));
        if (!attrs?.length) {
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tabs-attributes protyle-action";
        button.dataset.blockId = block.dataset.nodeId;
        button.setAttribute("contenteditable", "false");
        button.setAttribute("aria-label", options.label);
        button.innerHTML = '<svg class="tabs-attributes__icon"><use xlink:href="#iconAttr"></use></svg>';
        const summary = document.createElement("span");
        summary.className = "tabs-attributes__summary";
        attrs.forEach(attr => {
            const value = document.createElement("span");
            const focus = ["bookmark", "name", "alias", "memo", "av"].find(key =>
                attr.classList.contains(`protyle-attr--${key}`));
            value.dataset.focus = focus || "bookmark";
            const icon = attr.querySelector("svg");
            if (icon) {
                value.appendChild(icon.cloneNode(true));
            }
            const text = attr.textContent.trim() || attr.getAttribute("aria-label") || "";
            value.appendChild(document.createTextNode(text));
            value.title = text;
            summary.appendChild(value);
        });
        button.appendChild(summary);
        button.title = Array.from(summary.children).map(child => child.textContent).join(" · ");
        button.addEventListener("mousedown", event => {
            event.preventDefault();
            event.stopPropagation();
        });
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            options.open(block, (event.target as Element).closest<HTMLElement>("[data-focus]")?.dataset.focus || "bookmark");
        });
        block.dataset.tabsAttributes = "header";
        header.appendChild(button);
        button.classList.toggle("tabs-attributes--compact", tabs.clientWidth < 420);
    };
    render(item);
};
