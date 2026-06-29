// 拖拽时跟随鼠标的自定义双区提示框：上半=操作对象名称，下半=操作文案
// 通过 .drag-tip 类做全局单例，在编辑器和文档树两处 dragover 共用

export const transparentImgSrc = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const dragTipState = {
    rafId: 0, title: "", action: "", x: 0, y: 0,
    element: null as HTMLElement, titleElement: null as HTMLElement, actionElement: null as HTMLElement,
    lastTitle: "", lastAction: ""
};

const renderDragTip = () => {
    dragTipState.rafId = 0;
    if (!dragTipState.element || !dragTipState.element.isConnected) {
        // 优先复用已有的 .drag-tip（跨编辑器/文档树区域时避免重复创建）
        dragTipState.element = (document.querySelector(".drag-tip") as HTMLElement) || null;
        if (!dragTipState.element) {
            dragTipState.element = document.createElement("div");
            dragTipState.element.className = "tooltip drag-tip";
            // 拖拽提示需即时显示，覆盖 .tooltip 默认的 300ms 出现动画
            dragTipState.element.style.animation = "none";
            dragTipState.element.style.pointerEvents = "none";
            dragTipState.element.style.zIndex = "1000000";
            dragTipState.element.style.fontSize = "14px";
            dragTipState.element.style.lineHeight = "20px";
            // 锚定到视口原点，再由 transform 定位（transform 走 GPU 合成，不触发 layout）
            dragTipState.element.style.top = "0";
            dragTipState.element.style.left = "0";
            dragTipState.titleElement = document.createElement("div");
            dragTipState.titleElement.className = "drag-tip__title";
            dragTipState.titleElement.style.cssText = "max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--b3-tooltips-color);";
            dragTipState.actionElement = document.createElement("div");
            dragTipState.actionElement.className = "drag-tip__action";
            dragTipState.actionElement.style.cssText = "color:var(--b3-tooltips-second-color);font-size:12px;";
            dragTipState.element.append(dragTipState.titleElement, dragTipState.actionElement);
            document.body.append(dragTipState.element);
        } else {
            dragTipState.titleElement = dragTipState.element.querySelector(".drag-tip__title");
            dragTipState.actionElement = dragTipState.element.querySelector(".drag-tip__action");
        }
        dragTipState.lastTitle = "";
        dragTipState.lastAction = "";
    }
    // 名称/文案变化才写 textContent，减少 DOM 写入
    if (dragTipState.lastTitle !== dragTipState.title) {
        dragTipState.titleElement.textContent = dragTipState.title;
        dragTipState.lastTitle = dragTipState.title;
        // 名称为空时隐藏上半行
        dragTipState.titleElement.style.display = dragTipState.title ? "" : "none";
    }
    if (dragTipState.lastAction !== dragTipState.action) {
        dragTipState.actionElement.textContent = dragTipState.action;
        dragTipState.lastAction = dragTipState.action;
    }
    // 固定偏移到光标右下方，不读取 offsetHeight 以免触发同步布局造成卡顿
    dragTipState.element.style.transform = `translate(${dragTipState.x + 16}px, ${dragTipState.y + 16}px)`;
};

export const showDragTip = (title: string, action: string, x: number, y: number) => {
    /// #if MOBILE
    // 移动端不显示拖拽提示
    return;
    /// #endif
    dragTipState.title = title;
    dragTipState.action = action;
    dragTipState.x = x;
    dragTipState.y = y;
    // 合并到下一帧渲染，避免高频 dragover 下逐次写 DOM 造成卡顿
    if (!dragTipState.rafId) {
        dragTipState.rafId = requestAnimationFrame(renderDragTip);
    }
};

// Alt 拖拽插入引用时的行级竖线指示
let caretLineElement: HTMLElement | null = null;

export const showCaretLine = (left: number, top: number, height: number) => {
    if (!caretLineElement) {
        caretLineElement = document.createElement("div");
        caretLineElement.style.cssText = "position:fixed;width:2px;background-color:var(--b3-theme-primary-light);z-index:1000000;pointer-events:none;border-radius:var(--b3-border-radius);";
        document.body.append(caretLineElement);
    }
    caretLineElement.style.left = left + "px";
    caretLineElement.style.top = top + "px";
    caretLineElement.style.height = height + "px";
    caretLineElement.style.display = "";
};

export const hideCaretLine = () => {
    caretLineElement?.remove();
    caretLineElement = null;
};

export const hideDragTip = () => {
    if (dragTipState.rafId) {
        cancelAnimationFrame(dragTipState.rafId);
        dragTipState.rafId = 0;
    }
    dragTipState.element?.remove();
    dragTipState.element = null;
    dragTipState.titleElement = null;
    dragTipState.actionElement = null;
    dragTipState.lastTitle = "";
    dragTipState.lastAction = "";
    hideCaretLine();
};
