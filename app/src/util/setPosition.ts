import {getTopBarHeight} from "../layout/topBar";

export const setPosition = (element: HTMLElement, left: number, top: number, targetHeight = 0, targetLeft = 0) => {
    element.style.top = top + "px";
    element.style.left = left + "px";
    const rect = element.getBoundingClientRect();
    const topBarHeight = getTopBarHeight();
    if (rect.top < topBarHeight) {
        // 如果元素接触顶栏，向下移
        element.style.top = topBarHeight + "px";
    } else if (rect.bottom > window.innerHeight) {
        const y = top - rect.height - targetHeight;
        if (y > topBarHeight && (y + rect.height) < window.innerHeight) {
            // 如果元素底部超出窗口（下方空间不够），向上移
            element.style.top = y + "px";
        } else {
            // 如果上下空间都不够，向上移，但尽量靠底部
            element.style.top = Math.max(topBarHeight, window.innerHeight - rect.height) + "px";
        }
    }
    if (rect.right > window.innerWidth) {
        // 展现在左侧
        element.style.left = window.innerWidth - rect.width - targetLeft + "px";
    } else if (rect.left < 0) {
        // 依旧展现在左侧，只是位置右移
        element.style.left = "0";
    }
};
