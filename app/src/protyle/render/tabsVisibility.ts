export const isHiddenTabContent = (element: Element) => !!element.closest('.tab-item[data-tabs-hidden="true"]');

// 普通文本选区只携带可见正文；块选择通过原始 BlockDOM 保留全部页签。
export const visibleTabsSelectionHTML = (html: string) => {
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll('.tab-item[data-tabs-hidden="true"], .tabs-header').forEach(item => item.remove());
    template.content.querySelectorAll('.tabs[data-tabs-ready="true"] > .tab-item > .tab-item-info').forEach(item => {
        if ((item.parentElement as HTMLElement).dataset.tabsEditing !== "true") {
            item.remove();
        }
    });
    return template.innerHTML;
};
