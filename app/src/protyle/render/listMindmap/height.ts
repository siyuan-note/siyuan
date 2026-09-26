export const syncListMindmapHeight = (list: HTMLElement, host: HTMLElement) => {
    const height = list.style.height;
    if (height) {
        host.style.setProperty("--mindmap-view-height", height);
    } else {
        host.style.removeProperty("--mindmap-view-height");
    }
};
