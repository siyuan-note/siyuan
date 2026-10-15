export const isHiddenTabContent = (element: Element) => {
    let item = typeof element?.closest === "function" ? element.closest(".tab-item") : null;
    while (item) {
        const hidden = item.getAttribute("data-tabs-hidden");
        if (hidden === "true") {
            return true;
        }
        const tabs = item.parentElement;
        // 新插入的页签尚未渲染时，按持久选择判断正文可见性，避免光标触发额外切换。
        if (hidden !== "false" && tabs?.classList.contains("tabs")) {
            const items = Array.from(tabs.children).filter(child => child.classList.contains("tab-item"));
            const selected = items.find(child => child.getAttribute("data-node-id") === tabs.getAttribute("tabs-active-id")) || items[0];
            if (selected !== item) {
                return true;
            }
        }
        item = tabs?.closest(".tab-item");
    }
    return false;
};

// 普通文本选区只携带可见正文；块选择通过原始 BlockDOM 保留全部页签。
export const visibleTabsSelectionHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll('.tab-item[data-tabs-hidden="true"], .tabs-header, .tabs-divider, .tabs-attributes').forEach(item => item.remove());
    template.content.querySelectorAll("[data-tabs-attributes]").forEach(item => item.removeAttribute("data-tabs-attributes"));
    template.content.querySelectorAll('.tabs[data-tabs-ready="true"] > .tab-item > .tab-item-info').forEach(item => {
        if ((item.parentElement as HTMLElement).dataset.tabsEditing !== "true") {
            item.remove();
        }
    });
    template.content.querySelectorAll(".tabs, .tab-item, .tab-item-info, .tab-item-content").forEach(item => {
        item.replaceWith(...Array.from(item.childNodes));
    });
    return template.innerHTML;
};
