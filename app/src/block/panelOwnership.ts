const dialogOwners = new WeakMap<HTMLElement, HTMLElement>();

export const registerBlockPanelOwner = (element: HTMLElement, target?: HTMLElement) => {
    const dialog = target?.closest<HTMLElement>(".b3-dialog")?.parentElement;
    const parentPanel = target?.closest<HTMLElement>(".block__popover");
    const owner = dialog || (parentPanel && dialogOwners.get(parentPanel));
    if (owner) {
        dialogOwners.set(element, owner);
    }
};

export const getDialogBlockPanel = (dialog: HTMLElement, target: Element) => {
    const panel = target?.closest<HTMLElement>(".block__popover");
    return panel && dialogOwners.get(panel) === dialog ? panel : undefined;
};

export const destroyDialogBlockPanels = (dialog: HTMLElement) => {
    // 先收集再逆序销毁，避免父浮窗清理后丢失嵌套浮窗；固定浮窗保留原来的归属。
    const panels = (window.siyuan.blockPanels || []).filter(item =>
        dialogOwners.get(item.element) === dialog && item.element.dataset.pin !== "true");
    panels.reverse().forEach(item => item.destroy());
};

export const isBlockPanelTargetAvailable = (target: HTMLElement) =>
    target.isConnected && !target.closest('[data-dialog-closing="true"]');
