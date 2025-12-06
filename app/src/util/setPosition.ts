import {Constants} from "../constants";

export const setPosition = (element: HTMLElement, left: number, top: number, targetHeight = 0, targetLeft = 0) => {
    const isTopValid = !isNaN(top);   // 存在 top 时调整垂直方向位置
    const isLeftValid = !isNaN(left); // 存在 left 时调整水平方向位置
    if (isTopValid) {
        element.style.top = top + "px";
    }
    if (isLeftValid) {
        element.style.left = left + "px";
    }
    const rect = element.getBoundingClientRect();

    if (isTopValid) {
        if (rect.top < Constants.SIZE_TOOLBAR_HEIGHT) {
            // 如果元素接触顶栏，向下移
            element.style.top = Constants.SIZE_TOOLBAR_HEIGHT + "px";
        } else if (rect.bottom > window.innerHeight) {
            // 如果元素底部超出窗口（下方空间不够），向上移
            if (top - Constants.SIZE_TOOLBAR_HEIGHT >= rect.height) {
                // 如果上方空间足够，向上移
                element.style.top = (top - rect.height - targetHeight) + "px";
            } else {
                // 如果上下空间都不够，向上移，但尽量靠底部
                element.style.top = Math.max(Constants.SIZE_TOOLBAR_HEIGHT, window.innerHeight - rect.height) + "px";
            }
        }
    }

    if (isLeftValid) {
        if (rect.right > window.innerWidth) {
            // 展现在左侧
            element.style.left = window.innerWidth - rect.width - targetLeft + "px";
        } else if (rect.left < 0) {
            // 依旧展现在左侧，只是位置右移
            element.style.left = "0";
        }
    }
};
