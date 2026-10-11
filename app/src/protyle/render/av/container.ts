// 重建数据库容器时保留标签栏位置，仅在首次渲染或切换视图时滚动到目标标签。
export const replaceAVContainer = (blockElement: HTMLElement, html: string) => {
    const selector = ":scope > .av__container > .av__header > .av__views > .layout-tab-bar";
    const previousTabBar = blockElement.querySelector<HTMLElement>(selector);
    const scrollLeft = previousTabBar?.scrollLeft || 0;
    const previousViewID = previousTabBar?.querySelector<HTMLElement>(".item--focus")?.dataset.id;

    blockElement.firstElementChild.outerHTML = html;

    const tabBar = blockElement.querySelector<HTMLElement>(selector);
    if (!tabBar) {
        return;
    }
    tabBar.scrollLeft = scrollLeft;
    const focusedTab = tabBar.querySelector<HTMLElement>(".item--focus");
    if (!focusedTab || focusedTab.dataset.id === previousViewID || tabBar.clientWidth === 0) {
        return;
    }

    const tabBarRect = tabBar.getBoundingClientRect();
    const left = tabBarRect.left + tabBar.clientLeft;
    const right = left + tabBar.clientWidth;
    const focusedRect = focusedTab.getBoundingClientRect();
    // 标签宽于可视区域且覆盖两侧时保持位置，其余情况仅滚动到最近的边缘。
    if (focusedRect.left < left && focusedRect.right > right) {
        return;
    }
    if (focusedRect.left < left) {
        tabBar.scrollLeft += Math.max(focusedRect.left - left, focusedRect.right - right);
    } else if (focusedRect.right > right) {
        tabBar.scrollLeft += Math.min(focusedRect.left - left, focusedRect.right - right);
    }
};
