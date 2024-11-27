import {isMobile} from "../util/functions";

export const showTooltip = (message: string, target: Element, tooltipClass?: string) => {
    if (isMobile()) {
        return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height === 0 || !message) {
        hideTooltip();
        return;
    }
    let messageElement = document.getElementById("tooltip");
    if (!messageElement) {
        document.body.insertAdjacentHTML("beforeend", `<div class="tooltip" id="tooltip">${message}</div>`);
        messageElement = document.getElementById("tooltip");
    } else {
        messageElement.className = "tooltip";
        messageElement.innerHTML = message;
    }

    if (tooltipClass) {
        messageElement.classList.add("tooltip--" + tooltipClass);
    }

    let left = targetRect.left;
    let top = targetRect.bottom;
    const position = target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();

    if (position?.startsWith("right")) {
        // block icon and background icon
        left = targetRect.right - messageElement.clientWidth;
    }

    if (position?.endsWith("bottom")) {
        top += parseInt(position.replace("right", "").replace("left", ""));
    } else if (position?.endsWith("top")) {
        // 编辑器动态滚动条
        top = targetRect.top - messageElement.clientHeight;
    } else if (position === "parentE") {
        // file tree and outline、backlink
        top = parentRect.top;
        left = parentRect.right + 8;
    } else if (position?.endsWith("parentW")) {
        // 数据库属性视图
        top = parentRect.top + (parseInt(position) || 8);
        left = parentRect.left - messageElement.clientWidth;
    }

    const topHeight = position === "parentE" ? top : targetRect.top;
    const bottomHeight = window.innerHeight - top;

    messageElement.style.maxHeight = Math.max(topHeight, bottomHeight) + "px";

    if (top + messageElement.clientHeight > window.innerHeight && topHeight > bottomHeight) {
        messageElement.style.top = ((position === "parentE" ? parentRect.bottom : targetRect.top) - messageElement.clientHeight) + "px";
    } else {
        messageElement.style.top = top + "px";
    }

    if (left + messageElement.clientWidth > window.innerWidth) {
        if (position === "parentE") {
            messageElement.style.left = (parentRect.left - 8 - messageElement.clientWidth) + "px";
        } else {
            messageElement.style.left = (window.innerWidth - messageElement.clientWidth) + "px";
        }
    } else {
        messageElement.style.left = Math.max(0, left) + "px";
    }
};

export const hideTooltip = () => {
    const messageElement = document.getElementById("tooltip");
    if (messageElement) {
        messageElement.remove();
    }
};
