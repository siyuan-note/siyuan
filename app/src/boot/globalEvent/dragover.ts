import {Constants} from "../../constants";

export const cancelDrag = () => {
    const ghostElement = document.getElementById("dragGhost");
    if (ghostElement) {
        if (ghostElement.dataset.ghostType === "dock") {
            ghostElement.parentElement.querySelectorAll(".dock__item").forEach((item: HTMLElement) => {
                item.style.opacity = "";
            });
            document.querySelector("#dockMoveItem")?.remove();
        } else {
            const startElement = ghostElement.parentElement.querySelector(`[data-node-id="${ghostElement.getAttribute("data-node-id")}"]`) as HTMLElement;
            if (startElement) {
                startElement.style.opacity = "";
            }
            ghostElement.parentElement.querySelectorAll(".dragover__top, .dragover__bottom, .dragover, .dragover__current").forEach((item: HTMLElement) => {
                item.classList.remove("dragover__top", "dragover__bottom", "dragover", "dragover__current");
                item.style.opacity = "";
            });
        }
        ghostElement.remove();
        document.onmousemove = null;
        stopScrollAnimation();
    }
};

const dragoverScroll: {
    animationId?: number,
    element?: Element,
    space?: number // -1 向上；1 向下
    lastTime?: number
} = {};

export const stopScrollAnimation = () => {
    if (dragoverScroll.animationId) {
        cancelAnimationFrame(dragoverScroll.animationId);
        dragoverScroll.animationId = null;
        dragoverScroll.element = null;
        dragoverScroll.space = null;
        dragoverScroll.lastTime = null;
    }
};

const scrollAnimation = (timestamp: number) => {
    if (!dragoverScroll.lastTime) {
        dragoverScroll.lastTime = timestamp - 8;
    }
    dragoverScroll.element.scroll({
        top: dragoverScroll.element.scrollTop + (timestamp - dragoverScroll.lastTime) * dragoverScroll.space / 64
    });
    // 使用 requestAnimationFrame 继续动画
    dragoverScroll.animationId = requestAnimationFrame(scrollAnimation);
    dragoverScroll.lastTime = timestamp;
};

export const dragOverScroll = (moveEvent: MouseEvent, contentRect: DOMRect, element: Element) => {
    const dragToUp = moveEvent.clientY < contentRect.top + Constants.SIZE_SCROLL_TB;
    if (dragToUp ||
        moveEvent.clientY > contentRect.bottom - Constants.SIZE_SCROLL_TB) {
        dragoverScroll.space = dragToUp ? moveEvent.clientY - contentRect.top - Constants.SIZE_SCROLL_TB :
            moveEvent.clientY - contentRect.bottom + Constants.SIZE_SCROLL_TB;
        if (!dragoverScroll.animationId) {
            dragoverScroll.element = element;
            dragoverScroll.animationId = requestAnimationFrame(scrollAnimation);
        }
    } else {
        // 离开滚动区域时停止滚动
        stopScrollAnimation();
    }
};
