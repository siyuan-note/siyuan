// 拖拽时跟随鼠标的自定义双区提示框：上半=操作对象名称，下半=操作文案
// 通过 .drag-tip 类做全局单例，在编辑器和文档树两处 dragover 共用

const dragTipState = {
    rafId: 0, title: "", action: "", target: null as string | null, x: 0, y: 0,
    element: null as HTMLElement, titleElement: null as HTMLElement, actionElement: null as HTMLElement,
    lastTitle: "", lastAction: "", lastTarget: null as string | null, width: 0, height: 0,
    viewportWidth: 0, viewportHeight: 0,
    ghost: null as {width: number, height: number, offsetX: number, offsetY: number}
};

const getDragTipPosition = () => {
    const gap = 8;
    const pointerOffset = 16;
    const ghost = dragTipState.ghost;
    const anchorLeft = dragTipState.x - (ghost?.offsetX || 0);
    const anchorTop = dragTipState.y - (ghost?.offsetY || 0);
    let top = anchorTop - dragTipState.height - (ghost ? gap : pointerOffset);
    // 上方空间不足时放到拖拽预览下方，并将提示框限制在视口内。
    if (top < gap) {
        top = anchorTop + (ghost?.height || 0) + (ghost ? gap : pointerOffset);
    }
    return {
        left: Math.max(gap, Math.min(anchorLeft, window.innerWidth - dragTipState.width - gap)),
        top: Math.max(gap, Math.min(top, window.innerHeight - dragTipState.height - gap))
    };
};

const renderDragTip = () => {
    dragTipState.rafId = 0;
    let updateSize = false;
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
            dragTipState.actionElement = document.createElement("div");
            dragTipState.actionElement.className = "drag-tip__action";
            dragTipState.element.append(dragTipState.titleElement, dragTipState.actionElement);
            document.body.append(dragTipState.element);
        } else {
            dragTipState.titleElement = dragTipState.element.querySelector(".drag-tip__title");
            dragTipState.actionElement = dragTipState.element.querySelector(".drag-tip__action");
        }
        dragTipState.lastTitle = "";
        dragTipState.lastAction = "";
        dragTipState.lastTarget = null;
        updateSize = true;
    }
    // 名称/文案变化才写 textContent，减少 DOM 写入
    if (dragTipState.lastTitle !== dragTipState.title) {
        dragTipState.titleElement.textContent = dragTipState.title;
        dragTipState.lastTitle = dragTipState.title;
        // 名称为空时隐藏上半行
        dragTipState.titleElement.style.display = dragTipState.title ? "" : "none";
        updateSize = true;
    }
    if (dragTipState.lastAction !== dragTipState.action || dragTipState.lastTarget !== dragTipState.target) {
        const placeholder = dragTipState.action.indexOf("${x}");
        const hasTarget = dragTipState.target !== null && placeholder !== -1;
        dragTipState.actionElement.classList.toggle("drag-tip__action--target", hasTarget);
        if (hasTarget) {
            // 保留本地化模板的语序，仅缩略目标文字，完整显示操作和落点方向。
            const prefix = document.createElement("span");
            prefix.className = "drag-tip__label";
            prefix.textContent = dragTipState.action.slice(0, placeholder);
            const target = document.createElement("span");
            target.className = "drag-tip__target";
            target.textContent = dragTipState.target;
            const suffix = document.createElement("span");
            suffix.className = "drag-tip__label";
            suffix.textContent = dragTipState.action.slice(placeholder + 4);
            dragTipState.actionElement.replaceChildren(prefix, target, suffix);
        } else {
            dragTipState.actionElement.textContent = dragTipState.action;
        }
        dragTipState.lastAction = dragTipState.action;
        dragTipState.lastTarget = dragTipState.target;
        updateSize = true;
    }
    if (dragTipState.viewportWidth !== window.innerWidth || dragTipState.viewportHeight !== window.innerHeight) {
        dragTipState.viewportWidth = window.innerWidth;
        dragTipState.viewportHeight = window.innerHeight;
        updateSize = true;
    }
    if (updateSize) {
        const rect = dragTipState.element.getBoundingClientRect();
        dragTipState.width = rect.width;
        dragTipState.height = rect.height;
    }
    const position = getDragTipPosition();
    dragTipState.element.style.transform = `translate(${position.left}px, ${position.top}px)`;
};

export const setDragTipGhost = (element: HTMLElement, offsetX: number, offsetY: number) => {
    const rect = element.getBoundingClientRect();
    dragTipState.ghost = {
        width: rect.width,
        height: rect.height,
        offsetX,
        offsetY
    };
};

export const clearDragTipGhost = () => {
    dragTipState.ghost = null;
};

export const showDragTip = (title: string, action: string, x: number, y: number, target?: string) => {
    /// #if MOBILE
    // 移动端不显示拖拽提示
    return;
    /// #endif
    dragTipState.title = title;
    dragTipState.action = action;
    dragTipState.target = target !== undefined && action.includes("${x}") ? target : null;
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
    dragTipState.lastTarget = null;
    dragTipState.width = 0;
    dragTipState.height = 0;
    dragTipState.viewportWidth = 0;
    dragTipState.viewportHeight = 0;
    hideCaretLine();
};
