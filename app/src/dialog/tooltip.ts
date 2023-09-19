import {isMobile} from "../util/functions";

export const showTooltip = (message: string, target: Element, error = false) => {
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
        messageElement.innerHTML = message;
    }
    if (error) {
        messageElement.classList.add("tooltip--error");
    } else {
        messageElement.classList.remove("tooltip--error");
    }
    if (target.getAttribute("data-inline-memo-content")) {
        messageElement.classList.add("tooltip--memo"); // 为行级备注添加 class https://github.com/siyuan-note/siyuan/issues/6161
    } else {
        messageElement.classList.remove("tooltip--memo");
    }
    let left = targetRect.left;
    let top = targetRect.bottom;
    const position = target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();
    if (position === "right") {
        // block icon
        left = targetRect.right - messageElement.clientWidth;
    } else if (position === "parentE") {
        // file tree and outline、backlink
        top = parentRect.top;
        left = parentRect.right + 8;
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
