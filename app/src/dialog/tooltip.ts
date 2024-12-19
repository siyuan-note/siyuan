import {isMobile} from "../util/functions";
import {Constants} from "../constants";

export const showTooltip = (message: string, target: Element, tooltipClasses?: string[]) => {
    if (isMobile()) {
        return;
    }
    const targetRect = target.getBoundingClientRect();
    if (targetRect.height === 0 || !message) {
        hideTooltip();
        return;
    }

    // 合并默认类名和额外类名
    const additionalClasses = tooltipClasses ? tooltipClasses.map(cls => `tooltip--${cls}`).join(" ") : "";
    const className = ["tooltip ", additionalClasses].filter(Boolean).join("");

    let messageElement = document.getElementById("tooltip");
    if (!messageElement) {
        document.body.insertAdjacentHTML("beforeend", `<div class="${className}" id="tooltip">${message}</div>`);
        messageElement = document.getElementById("tooltip");
    } else {
        if (messageElement.className !== className) {
            messageElement.className = className;
        }
        if (messageElement.innerHTML !== message) {
            messageElement.innerHTML = message;
            // 避免原本的 top 和 left 影响计算
            messageElement.removeAttribute("style");
        }
    }

    let left = targetRect.left;
    let top = targetRect.bottom;

    // position: parentE; parentW; ${number}parentW; ${number}bottom;
    // right; right${number}bottom; right${number}top; top;
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
    } else if (position?.endsWith("west")) {
        // 删除按钮
        top = targetRect.top + (parseInt(position) || 0);
        left = targetRect.left - messageElement.clientWidth - 8;
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
            messageElement.style.left = (window.innerWidth - 1 - messageElement.clientWidth) + "px";
        }
    } else {
        messageElement.style.left = Math.max(0, left) + "px";
    }
};

export const hideTooltip = () => {
    const messageElement = document.getElementById("tooltip");
    if (messageElement) {
        messageElement.classList.add("fn__none");
    }
};
