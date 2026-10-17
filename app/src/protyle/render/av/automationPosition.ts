import {getTopBarHeight} from "../../../layout/getTopBarHeight";
import {setPosition} from "../../../util/setPosition";

export const setAutomationMenuPosition = (menuElement: HTMLElement, anchor: DOMRect) => {
    const margin = 8;
    const topBarHeight = getTopBarHeight();
    // 为靠近窗口底部的入口预留可操作区域，位置只随锚点和窗口变化，不随表单内容变化。
    const top = Math.max(topBarHeight, Math.min(anchor.bottom, window.innerHeight - 320 - margin));
    menuElement.style.setProperty("--av-automation-max-height", Math.max(0, window.innerHeight - top - margin) + "px");
    setPosition(menuElement, anchor.right - menuElement.clientWidth, top);
};
