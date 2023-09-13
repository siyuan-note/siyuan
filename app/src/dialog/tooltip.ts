import {setPosition} from "../util/setPosition";
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
    if (target.parentElement.getAttribute("data-type") === "navigation-file") {
        const parentRect = target.parentElement.getBoundingClientRect();
        setPosition(messageElement, parentRect.right + 8, parentRect.top);
        return;
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
    if (target.getAttribute("data-position") === "right") {
        left = targetRect.right - messageElement.clientWidth;
    }
    const bottomHeight = window.innerHeight - targetRect.bottom;
    messageElement.style.maxHeight = Math.max(targetRect.top, bottomHeight) + "px";
    if (targetRect.top > bottomHeight) {
        messageElement.style.top = (targetRect.top - messageElement.clientHeight) + "px";
    } else {
        messageElement.style.top = targetRect.bottom + "px";
    }
    if (left + messageElement.clientWidth > window.innerWidth) {
        messageElement.style.left = (window.innerWidth - messageElement.clientWidth) + "px";
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
