import {Constants} from "../constants";

export const setPosition = (element: HTMLElement, x: number, y: number, targetHeight = 0, targetLeft = 0) => {
    element.style.top = y + "px";
    element.style.left = x + "px";
    const rect = element.getBoundingClientRect();
    
    // 垂直方向调整
    if (rect.bottom > window.innerHeight || rect.top < Constants.SIZE_TOOLBAR_HEIGHT) {
        const bottomSpace = window.innerHeight - y;
        const topSpace = y - Constants.SIZE_TOOLBAR_HEIGHT;
        
        if (bottomSpace >= rect.height) {
            // 如果下方空间足够，直接使用原位置
            element.style.top = y + "px";
        } else if (topSpace >= rect.height) {
            // 如果上方空间足够，向上调整
            element.style.top = (y - rect.height - targetHeight) + "px";
        } else {
            // 如果上下空间都不够，优先展现在下部
            const maxTop = Math.max(Constants.SIZE_TOOLBAR_HEIGHT, window.innerHeight - rect.height);
            element.style.top = maxTop + "px";
        }
    }
    
    // 水平方向调整
    if (rect.right > window.innerWidth) {
        // 展现在左侧
        element.style.left = `${window.innerWidth - rect.width - targetLeft}px`;
    } else if (rect.left < 0) {
        // 依旧展现在左侧，只是位置右移
        element.style.left = "0";
    }
};
