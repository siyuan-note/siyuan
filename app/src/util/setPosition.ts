import {Constants} from "../constants";

export const setPosition = (element: HTMLElement, x: number, y: number, targetHeight = 0, targetLeft = 0) => {
    element.style.top = y + "px";
    element.style.left = x + "px";
    const rect = element.getBoundingClientRect();
    // 上下超出屏幕
    if (rect.bottom > window.innerHeight || rect.top < Constants.SIZE_TOOLBAR_HEIGHT) {
        const top = y - rect.height - targetHeight;
        if (top > Constants.SIZE_TOOLBAR_HEIGHT && (top + rect.height) < window.innerHeight) {
            // 上部
            element.style.top = top + "px";
        } else if (top <= Constants.SIZE_TOOLBAR_HEIGHT) {
            // 位置超越到屏幕上方外时，需移动到屏幕顶部。eg：光标在第一个块，然后滚动到上方看不见的位置，按 ctrl+a
            element.style.top = Constants.SIZE_TOOLBAR_HEIGHT + "px";
        } else {
            // 依旧展现在下部，只是位置上移
            element.style.top = Math.max(Constants.SIZE_TOOLBAR_HEIGHT, window.innerHeight - rect.height) + "px";
        }
    }
    if (rect.right > window.innerWidth) {
        // 展现在左侧
        element.style.left = `${window.innerWidth - rect.width - targetLeft}px`;
    } else if (rect.left < 0) {
        // 依旧展现在左侧，只是位置右移
        element.style.left = "0";
    }
};
