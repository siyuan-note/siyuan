const cellPanelTargets = new WeakMap<Element, Element>();

// 记录单元格面板所属的显示实例，视图配置面板不随单元格移出当前结果而关闭。
export const setAVCellPanelTarget = (panelElement: Element, blockElement: Element) => {
    cellPanelTargets.set(panelElement, blockElement);
};

export const isAVCellPanelForBlock = (panelElement: Element, blockElement: Element) =>
    cellPanelTargets.get(panelElement) === blockElement;
