import {isMobile} from "../util/functions";

let hideTooltipTimeout: NodeJS.Timeout | null = null;

export const showTooltip = (message: string, target: Element, tooltipClass?: string) => {
    if (isMobile()) {
        return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height === 0 || !message) {
        hideTooltip();
        return;
    }

    // 清除 hideTooltip 的定时器
    if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
        hideTooltipTimeout = null;
    }

    let messageElement = document.getElementById("tooltip");
    if (!messageElement) {
        document.body.insertAdjacentHTML("beforeend", `<div class="tooltip${!tooltipClass ? "" : " tooltip--" + tooltipClass}" id="tooltip">${message}</div>`);
        messageElement = document.getElementById("tooltip");
    } else {
        const currentClassName = messageElement.className;
        const currentMessage = messageElement.textContent;

        let newClassName = "tooltip";
        if (tooltipClass) {
            newClassName += " tooltip--" + tooltipClass;
        }
        // 避免不必要的更新
        if (currentClassName !== newClassName) {
            messageElement.className = newClassName;
        }
        if (currentMessage !== message) {
            // 鼠标在按钮等多层结构的元素上小幅移动时会频繁更新
            messageElement.innerHTML = message;
        }
    }

    let left = targetRect.left;
    let top = targetRect.bottom;
    const position = target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();

    if (position?.startsWith("right")) {
        // block icon and background icon
        left = targetRect.right - messageElement.clientWidth;
    }

    if (position === "parentE") {
        // file tree and outline、backlink
        top = parentRect.top;
        left = parentRect.right + 8;
    } else if (position?.endsWith("parentW")) {
        // 数据库属性视图
        top = parentRect.top + (parseInt(position) || 8);
        left = parentRect.left - messageElement.clientWidth;
    } else if (position?.endsWith("bottom")) {
        top += parseInt(position.replace("right", "").replace("left", ""));
    } else if (position?.endsWith("top")) {
        // 编辑器动态滚动条
        top = targetRect.top - messageElement.clientHeight;
    }

    const topHeight = position === "parentE" ? top : targetRect.top;
    const bottomHeight = window.innerHeight - top;

    messageElement.style.maxHeight = Math.max(topHeight, bottomHeight) + "px";

    // 避免原本的 top 和 left 影响计算
    messageElement.style.top = "0px";
    messageElement.style.left = "0px";

    if (top + messageElement.clientHeight > window.innerHeight && topHeight > bottomHeight) {
        messageElement.style.top = ((position === "parentE" ? parentRect.bottom : targetRect.top) - messageElement.clientHeight) + "px";
    } else {
        messageElement.style.top = top + "px";
    }

    if (left + messageElement.clientWidth > window.innerWidth) {
        if (position === "parentE") {
            messageElement.style.left = (parentRect.left - 8 - messageElement.clientWidth) + "px";
        } else {
            messageElement.style.left = (window.innerWidth - 1 - messageElement.clientWidth) + "px";
        }
    } else {
        messageElement.style.left = Math.max(0, left) + "px";
    }
};

export const hideTooltip = () => {
    if (hideTooltipTimeout) {
        clearTimeout(hideTooltipTimeout);
    }
    hideTooltipTimeout = setTimeout(() => {
        const messageElement = document.getElementById("tooltip");
        if (messageElement) {
            messageElement.remove();
        }
        hideTooltipTimeout = null;
    }, 50);
};
