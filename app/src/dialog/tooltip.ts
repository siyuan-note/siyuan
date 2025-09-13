import {isMobile} from "../util/functions";

export const showTooltip = (message: string, target: Element, tooltipClass?: string, delay?: number) => {
    if (isMobile()) {
        return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height === 0 || !message) {
        hideTooltip();
        return;
    }

    const messageElement = document.getElementById("tooltip");
    messageElement.className = tooltipClass ? `tooltip tooltip--${tooltipClass}` : "tooltip";
    messageElement.innerHTML = message;
    // 避免原本的 top 和 left 影响计算
    messageElement.removeAttribute("style");

    delay ??= parseInt(target.closest("[data-tooltips-delay]")?.getAttribute("data-tooltips-delay") || "500");
    messageElement.style.setProperty("--b3-tooltips-delay", delay + "ms");


    const position = target.getAttribute("data-position");
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
        const positionDiff = parseInt(position) || 0.5;
        top = Math.max(0, targetRect.top - (messageElement.clientHeight - targetRect.height) / 2);
        if (top > window.innerHeight - messageElement.clientHeight) {
            top = window.innerHeight - messageElement.clientHeight;
        }
        left = targetRect.left - messageElement.clientWidth - positionDiff;
        if (left < 0) {
            left = targetRect.right;
        }
    } else if (position === "north") {
        // north: av 视图，列，多选描述
        const positionDiff = 0.5;
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
        const positionDiff = parseInt(position) || 0.5;
        left = Math.max(0, targetRect.left - (messageElement.clientWidth - targetRect.width) / 2);
        top = targetRect.bottom + positionDiff;

        if (top + messageElement.clientHeight > window.innerHeight) {
            if (targetRect.top - positionDiff > window.innerHeight - top) {
                top = targetRect.top - positionDiff - messageElement.clientHeight;
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
    messageElement.style.left = left + "px";
};

export const hideTooltip = () => {
    document.getElementById("tooltip").classList.add("fn__none");
};
