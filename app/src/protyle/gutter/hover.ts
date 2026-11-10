import {hasClosestBlock} from "../util/hasClosest";

const pendingGutterHovers = new WeakMap<HTMLElement, number>();
const gutterHoverPaths = new WeakMap<HTMLElement, {
    button: HTMLElement;
    rect: DOMRect;
    point?: {x: number; y: number};
    origin?: {x: number; y: number};
    protected: boolean;
}>();

const getVerticalGutterButton = (element: HTMLElement) => {
    if (element.classList.contains("fn__none") || !element.classList.contains("protyle-gutters--full") ||
        element.style.flexDirection !== "column") {
        return;
    }
    const buttons = element.querySelectorAll<HTMLElement>("button[data-node-id]");
    return buttons[buttons.length - 1];
};

export const cancelGutterHover = (element?: HTMLElement) => {
    if (!element) {
        return;
    }
    const timer = pendingGutterHovers.get(element);
    if (timer !== undefined) {
        window.clearTimeout(timer);
        pendingGutterHovers.delete(element);
    }
};

const resetGutterHover = (element?: HTMLElement) => {
    cancelGutterHover(element);
    if (element) {
        gutterHoverPaths.delete(element);
    }
};

export const bindGutterHover = (protyle: IProtyle, pointerEvents: boolean) => {
    const reset = () => resetGutterHover(protyle.gutter?.element);
    const update = (event: MouseEvent | PointerEvent) => {
        if (pointerEvents && (event as PointerEvent).pointerType !== "mouse" || event.buttons !== 0 ||
            (event.target as Element).closest(".protyle") !== protyle.element) {
            reset();
            return;
        }
        const gutter = protyle.gutter;
        const button = gutter && getVerticalGutterButton(gutter.element);
        if (!button) {
            reset();
            return;
        }
        const rect = gutter.element.getBoundingClientRect();
        let state = gutterHoverPaths.get(gutter.element);
        if (!state || state.button !== button || rect.left !== state.rect.left || rect.top !== state.rect.top ||
            rect.right !== state.rect.right || rect.bottom !== state.rect.bottom) {
            reset();
            state = {button, rect, protected: false};
            gutterHoverPaths.set(gutter.element, state);
        }
        const point = {x: event.clientX, y: event.clientY};
        const wasProtected = state.protected;
        const gap = 6;
        const inColumn = point.x >= rect.left - gap && point.x <= rect.right + gap &&
            point.y >= rect.top - gap && point.y <= rect.bottom + gap;
        if (inColumn) {
            state.protected = true;
            state.origin = undefined;
        } else if (gutter.getNodeElement(protyle, button)?.contains(event.target as Node)) {
            state.protected = false;
            state.origin = point;
        } else {
            // 正文中的起点和整列块标形成三角通道，朝块标移动时允许经过其他正文块。
            const origin = state.origin;
            const direction = origin && origin.x >= rect.right ? 1 : -1;
            const edge = direction === 1 ? rect.right : rect.left;
            const distance = origin ? (origin.x - edge) * direction : 0;
            const progress = distance > 0 ? (origin.x - point.x) * direction / distance : -1;
            state.protected = !!origin && !!state.point && progress >= 0 && progress <= 1 &&
                (point.x - state.point.x) * direction <= 2 &&
                point.y >= origin.y + (rect.top - gap - origin.y) * progress - gap &&
                point.y <= origin.y + (rect.bottom + gap - origin.y) * progress + gap;
            if (!state.protected) {
                state.origin = undefined;
            }
        }
        state.point = point;
        if (state.protected) {
            cancelGutterHover(gutter.element);
        } else if (wasProtected) {
            const block = hasClosestBlock(event.target as Node);
            if (block && protyle.wysiwyg.element.contains(block)) {
                renderGutterOnHover(protyle, block, event.target as Element);
            }
        }
    };
    // 捕获阶段先更新路径，正文、序标和编辑器留白的悬停入口读取同一份保护状态。
    protyle.element.addEventListener(pointerEvents ? "pointerover" : "mouseover", update, {capture: true, passive: true});
    protyle.element.addEventListener(pointerEvents ? "pointermove" : "mousemove", update, {capture: true, passive: true});
    protyle.element.addEventListener("mouseleave", reset);
    protyle.element.addEventListener("pointerdown", reset, {capture: true, passive: true});
    protyle.element.addEventListener("scroll", reset, {capture: true, passive: true});
};

// 移向竖排块标时允许短暂经过相邻块，停留在新块上才切换整组块标。
export const renderGutterOnHover = (protyle: IProtyle, element: HTMLElement, target?: Element) => {
    const gutter = protyle.gutter;
    const gutterElement = gutter.element;
    cancelGutterHover(gutterElement);
    const currentButton = getVerticalGutterButton(gutterElement);
    const path = gutterHoverPaths.get(gutterElement);
    if (currentButton && path?.button === currentButton && path.protected) {
        return;
    }
    if (!currentButton || currentButton.dataset.nodeId === element.getAttribute("data-node-id")) {
        gutter.render(protyle, element, target);
        return;
    }
    const timer = window.setTimeout(() => {
        if (pendingGutterHovers.get(gutterElement) !== timer) {
            return;
        }
        pendingGutterHovers.delete(gutterElement);
        // 隐藏、切换文档或其他入口重绘块标后，不恢复过期的悬停目标。
        if (protyle.gutter === gutter && gutterElement.isConnected && element.isConnected &&
            !gutterElement.classList.contains("fn__none") && gutterElement.contains(currentButton) &&
            protyle.wysiwyg.element.contains(element)) {
            gutterHoverPaths.delete(gutterElement);
            gutter.render(protyle, element, target);
        }
    }, 150);
    pendingGutterHovers.set(gutterElement, timer);
};
