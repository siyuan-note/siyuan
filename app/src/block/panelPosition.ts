import {getTopBarHeight} from "../layout/getTopBarHeight";
import {setPosition} from "../util/setPosition";

export const positionBlockPanel = (element: HTMLElement, targetRect: DOMRect) => {
    // 根据完整内容高度选择展开方向，空间不足时使用较大的一侧。
    element.style.maxHeight = "";
    element.style.minHeight = "";
    const height = element.getBoundingClientRect().height;
    const above = Math.max(0, targetRect.top - getTopBarHeight() - 8);
    const below = Math.max(0, window.innerHeight - targetRect.bottom - 12);
    const openAbove = height > below && above > below;
    const availableHeight = Math.floor(openAbove ? Math.min(height, above) : below);
    const style = getComputedStyle(element);
    const extraHeight = style.boxSizing === "border-box" ? 0 :
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const maxHeight = Math.max(0, availableHeight - extraHeight);
    element.style.minHeight = Math.min(parseFloat(style.minHeight) || 0, maxHeight) + "px";
    element.style.maxHeight = maxHeight + "px";

    // 先约束高度再定位，上方浮窗的底边紧邻锚点，并保留边缘拖拽空间。
    const top = openAbove ? targetRect.top - element.getBoundingClientRect().height - 8 : targetRect.bottom + 4;
    setPosition(element, targetRect.left, top, 0, 8);
};
