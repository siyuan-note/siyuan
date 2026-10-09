import {isMobile} from "../util/functions";
import {emitToPlugins, forEachPluginSubscriber} from "../plugin/EventBusCore";
import {initHoverInput, isTouchHoverInput} from "../util/hoverInput";

// 无编辑器的窗口复用提示框渲染，不注册块预览事件。
export const initTooltips = () => {
    initHoverInput();
    document.addEventListener("mouseover", (event: MouseEvent) => {
        if (isTouchHoverInput()) {
            return;
        }
        const target = (event.target as Element).closest(".ariaLabel");
        if (target && !target.classList.contains("b3-tooltips")) {
            let message = target.getAttribute("aria-label") || "";
            try {
                message = decodeURIComponent(message);
            } catch (error) {
                // 保留包含不完整 URI 转义的提示文本。
            }
            if (message) {
                showTooltip(message, target, undefined, event);
                return;
            }
        }
        const tooltip = document.getElementById("tooltip");
        if (!tooltip.contains(event.target as Node) || tooltip.clientHeight >= tooltip.scrollHeight) {
            hideTooltip();
        }
    });
    document.addEventListener("mouseleave", hideTooltip);
};

export const showTooltip = (
    message: string,
    target: Element,
    tooltipClass?: string,
    event?: MouseEvent,
    space: number = 0.5,
    positionOverride?: string,
) => {
    if (isMobile() || !message || (isTouchHoverInput() && event && tooltipClass !== "error")) {
        return;
    }
    const messageElement = document.getElementById("tooltip");
    const showDetail = {
        message,
        target,
        tooltipElement: messageElement,
    };
    emitToPlugins("before-show-tooltip", showDetail);
    message = showDetail.message;
    if (!message) {
        hideTooltip();
        return;
    }
    let targetRect = target.getBoundingClientRect();
    // 跨行元素
    const clientRects = Array.from(target.getClientRects());
    if (clientRects.length > 1) {
        if (event) {
            // 选择鼠标附近的矩形
            clientRects.forEach(item => {
                if (event.clientY >= item.top - 3 && event.clientY <= item.bottom) {
                    targetRect = item;
                }
            });
        } else {
            // 选择宽度最大的矩形
            let lastWidth = 0;
            clientRects.forEach(item => {
                if (item.width > lastWidth) {
                    targetRect = item;
                }
                lastWidth = item.width;
            });
        }
    }
    if (targetRect.height === 0) {
        hideTooltip();
        return;
    }
    messageElement.className = tooltipClass ? `tooltip tooltip--${tooltipClass}` : "tooltip";
    messageElement.classList.toggle("tooltip--hover", !!event && tooltipClass !== "error");
    messageElement.innerHTML = window.DOMPurify.sanitize(message);
    // 避免原本的 top 和 left 影响计算
    messageElement.removeAttribute("style");
    // 普通提示不拦截目标点击，包含链接或控件的提示仍可交互。
    if (!messageElement.querySelector("a, button, input, select, textarea, [contenteditable='true'], [tabindex], [role='button']")) {
        messageElement.style.pointerEvents = "none";
    }
    const position = positionOverride || target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();

    let left;
    let top;
    if (position === "parentE") {
        // parentE: file tree and outline、backlink & viewcard
        top = Math.max(0, parentRect.top - (messageElement.clientHeight - parentRect.height) / 2);
        if (top > window.innerHeight - messageElement.clientHeight) {
            top = window.innerHeight - messageElement.clientHeight;
        }
        left = parentRect.right + 8;
        if (left + messageElement.clientWidth > window.innerWidth) {
            left = parentRect.left - messageElement.clientWidth - 8;
        }
    } else if (position === "parentW") {
        // ${number}parentW: av 属性视图 & col & select
        top = Math.max(0, parentRect.top - (messageElement.clientHeight - parentRect.height) / 2);
        if (top > window.innerHeight - messageElement.clientHeight) {
            top = window.innerHeight - messageElement.clientHeight;
        }
        left = parentRect.left - messageElement.clientWidth;
        if (left < 0) {
            left = parentRect.right;
        }
    } else if (position?.endsWith("west")) {
        // west: gutter & 标题图标 & av relation
        const positionDiff = parseInt(position) || space;
        top = Math.max(0, targetRect.top - (messageElement.clientHeight - targetRect.height) / 2);
        if (top > window.innerHeight - messageElement.clientHeight) {
            top = window.innerHeight - messageElement.clientHeight;
        }
        left = targetRect.left - messageElement.clientWidth - positionDiff;
        if (left < 0) {
            left = targetRect.right;
        }
    } else if (position?.endsWith("east")) {
        // east: 布局菜单
        const positionDiff = parseInt(position) || space;
        top = Math.max(0, targetRect.top - (messageElement.clientHeight - targetRect.height) / 2);
        if (top > window.innerHeight - messageElement.clientHeight) {
            top = window.innerHeight - messageElement.clientHeight;
        }
        left = targetRect.right + positionDiff;
        if (left + messageElement.clientWidth > window.innerWidth) {
            left = targetRect.left - messageElement.clientWidth - positionDiff;
        }
    } else if (position?.endsWith("north")) {
        // north: av 视图，列，多选描述, protyle-icon
        const positionDiff = parseInt(position) || space;
        left = Math.max(0, targetRect.left - (messageElement.clientWidth - targetRect.width) / 2);
        top = targetRect.top - messageElement.clientHeight - positionDiff;
        if (top < 0) {
            if (targetRect.top < window.innerHeight - targetRect.bottom) {
                top = targetRect.bottom + positionDiff;
                messageElement.style.maxHeight = (window.innerHeight - top) + "px";
            } else {
                top = 0;
                messageElement.style.maxHeight = (targetRect.top - positionDiff) + "px";
            }
        }
        if (left + messageElement.clientWidth > window.innerWidth) {
            left = window.innerWidth - messageElement.clientWidth;
        }
    } else {
        // ${number}south & 默认值
        const positionDiff = parseInt(position) || space;
        left = Math.max(0, targetRect.left - (messageElement.clientWidth - targetRect.width) / 2);
        top = targetRect.bottom + positionDiff;

        if (top + messageElement.clientHeight > window.innerHeight) {
            if (targetRect.top - positionDiff > window.innerHeight - top) {
                top = Math.max(0, targetRect.top - positionDiff - messageElement.clientHeight);
                messageElement.style.maxHeight = (targetRect.top - positionDiff) + "px";
            } else {
                messageElement.style.maxHeight = (window.innerHeight - top) + "px";
            }
        }
        if (left + messageElement.clientWidth > window.innerWidth) {
            left = window.innerWidth - messageElement.clientWidth;
        }
    }
    messageElement.style.top = top + "px";
    messageElement.style.left = Math.max(0, left) + "px";
    // 与 data-position 同套风格：触发元素可用 data-delay 指定悬浮延迟（毫秒），未设置时沿用 SCSS 默认值
    const tooltipDelay = target.getAttribute("data-delay");
    if (tooltipDelay) {
        messageElement.style.animationDelay = tooltipDelay + "ms";
    }
};

export const hideTooltip = () => {
    const messageElement = document.getElementById("tooltip");
    if (messageElement.classList.contains("fn__none")) {
        return;
    }
    forEachPluginSubscriber("before-hide-tooltip", eventBus => {
        eventBus.emit("before-hide-tooltip", {
            tooltipElement: messageElement,
        });
    });
    messageElement.classList.add("fn__none");
};
