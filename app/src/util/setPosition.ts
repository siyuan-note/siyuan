import {getTopBarHeight} from "../layout/getTopBarHeight";

export const setPosition = (element: HTMLElement, left: number, top: number, targetHeight = 0, targetLeft = 0, sticky = false) => {
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

    if (sticky) {
        // 粘滞定位：同一锚点（top 不变）下保持稳定
        // - 下方有空间时优先向下展开（用首次锚点 top，底部随高度自然延伸）
        // - 下方放不下时才向上撑开（锁定底部边缘，顶部上移）
        // 由此菜单高度增减时既不跳动也不溢出
        const lockedBottom = element.dataset.positionBottom;
        const lockedX = element.dataset.positionX;
        const sameAnchor = element.dataset.positionTop === String(top);
        if (sameAnchor && lockedBottom !== undefined) {
            if (top + rect.height <= window.innerHeight) {
                // 下方放得下：向下展开，回到首次锚点
                element.style.top = top + "px";
            } else {
                // 下方放不下：向上撑开，锁定底部边缘
                const newTop = parseFloat(lockedBottom) - rect.height;
                element.style.top = (newTop >= topBarHeight ? newTop : topBarHeight) + "px";
            }
        }
        if (sameAnchor && lockedX !== undefined) {
            element.style.left = lockedX + "px";
        }

        // 水平溢出修正（仅在未锁定时做）
        if (!(sameAnchor && lockedX !== undefined)) {
            if (rect.right > window.innerWidth) {
                element.style.left = window.innerWidth - rect.width - targetLeft + "px";
            } else if (rect.left < 0) {
                element.style.left = "0";
            }
        }

        element.dataset.positionTop = String(top);
        const actualRect = element.getBoundingClientRect();
        element.dataset.positionBottom = String(actualRect.bottom);
        element.dataset.positionX = String(parseFloat(element.style.left));
    } else {
        if (rect.right > window.innerWidth) {
            // 展现在左侧
            element.style.left = window.innerWidth - rect.width - targetLeft + "px";
        } else if (rect.left < 0) {
            // 依旧展现在左侧，只是位置右移
            element.style.left = "0";
        }
    }
};
