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
    space?: number, // -1 向上或向左；1 向下或向右
    direction?: "x" | "y",
    lastTime?: number
} = {};

export const stopScrollAnimation = () => {
    if (dragoverScroll.animationId) {
        cancelAnimationFrame(dragoverScroll.animationId);
        dragoverScroll.animationId = null;
        dragoverScroll.element = null;
        dragoverScroll.space = null;
        dragoverScroll.direction = null;
        dragoverScroll.lastTime = null;
    }
};

const scrollAnimation = (timestamp: number) => {
    if (!dragoverScroll.lastTime) {
        dragoverScroll.lastTime = timestamp - 8;
    }
    const distance = (timestamp - dragoverScroll.lastTime) * dragoverScroll.space / 64;
    if (dragoverScroll.direction === "x") {
        dragoverScroll.element.scroll({left: dragoverScroll.element.scrollLeft + distance});
    } else {
        dragoverScroll.element.scroll({top: dragoverScroll.element.scrollTop + distance});
    }
    // 使用 requestAnimationFrame 继续动画
    dragoverScroll.animationId = requestAnimationFrame(scrollAnimation);
    dragoverScroll.lastTime = timestamp;
};

export const dragOverScroll = (moveEvent: MouseEvent, contentRect: DOMRect, element: Element, direction: "x" | "y" = "y") => {
    const clientPosition = direction === "x" ? moveEvent.clientX : moveEvent.clientY;
    const start = direction === "x" ? contentRect.left : contentRect.top;
    const end = direction === "x" ? contentRect.right : contentRect.bottom;
    const dragToStart = clientPosition < start + Constants.SIZE_SCROLL_TB;
    if (dragToStart || clientPosition > end - Constants.SIZE_SCROLL_TB) {
        if (dragoverScroll.animationId &&
            (dragoverScroll.element !== element || dragoverScroll.direction !== direction)) {
            stopScrollAnimation();
        }
        dragoverScroll.space = dragToStart ? clientPosition - start - Constants.SIZE_SCROLL_TB :
            clientPosition - end + Constants.SIZE_SCROLL_TB;
        if (!dragoverScroll.animationId) {
            dragoverScroll.element = element;
            dragoverScroll.direction = direction;
            dragoverScroll.animationId = requestAnimationFrame(scrollAnimation);
        }
    } else {
        // 离开滚动区域时停止滚动
        stopScrollAnimation();
    }
};
