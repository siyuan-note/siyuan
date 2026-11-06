const cellPanelTargets = new WeakMap<Element, Element>();
const cellPanelElements = new WeakMap<Element, HTMLElement[]>();

// 记录单元格面板所属的显示实例，视图配置面板不随单元格移出当前结果而关闭。
export const setAVCellPanelTarget = (panelElement: Element, blockElement: Element, cellElements?: HTMLElement[]) => {
    cellPanelTargets.set(panelElement, blockElement);
    if (cellElements) cellPanelElements.set(panelElement, cellElements);
};

export const getAVCellPanelTarget = (panelElement: Element) => cellPanelTargets.get(panelElement);
export const getAVCellPanelElements = (panelElement: Element) => cellPanelElements.get(panelElement);

export const isAVCellPanelForBlock = (panelElement: Element, blockElement: Element) =>
    cellPanelTargets.get(panelElement) === blockElement;
