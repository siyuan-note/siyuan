export const clearTabDragPreview = (tabHeadersElement?: HTMLElement) => {
    if (tabHeadersElement) {
        tabHeadersElement.classList.remove("layout-tab-bars--drag");
        tabHeadersElement.querySelectorAll(".layout-tab-bar li[data-clone='true']").forEach((item) => {
            item.remove();
        });
    } else {
        document.querySelectorAll(".layout-tab-bars--drag").forEach((item) => {
            item.classList.remove("layout-tab-bars--drag");
        });
        document.querySelectorAll(".layout-tab-bar li[data-clone='true']").forEach((item) => {
            item.remove();
        });
    }
    if (!tabHeadersElement || window.siyuan.currentDragOverTabHeadersElement === tabHeadersElement) {
        window.siyuan.currentDragOverTabHeadersElement = undefined;
    }
};

export const reorderTabItems = <T extends { id: string }>(items: T[], item: T, nextId?: string) => {
    const currentIndex = items.indexOf(item);
    if (currentIndex === -1) {
        return false;
    }
    items.splice(currentIndex, 1);
    const nextIndex = nextId ? items.findIndex((currentItem) => currentItem.id === nextId) : -1;
    if (nextIndex === -1) {
        items.push(item);
    } else {
        items.splice(nextIndex, 0, item);
    }
    return true;
};

export const findNextTabId = <T extends { id: string }>(items: T[], candidateIds: string[]) => {
    const existingIds = new Set(items.map((item) => item.id));
    return candidateIds.find((id) => existingIds.has(id));
};
