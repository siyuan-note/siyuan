import {setPosition} from "../../../util/setPosition";

const menuAnchors = new WeakMap<HTMLElement, DOMRect>();

export const setSelectMenuPosition = (menuElement: HTMLElement, cellElement: HTMLElement) => {
    if (cellElement.isConnected) {
        menuAnchors.set(menuElement, cellElement.getBoundingClientRect());
    }
    // 属性刷新会替换字段元素，继续使用最近的有效锚点，避免菜单跳到窗口左上角。
    const rect = menuAnchors.get(menuElement);
    if (rect) {
        setPosition(menuElement, rect.left, rect.bottom, rect.height, 0, true);
    }
};
