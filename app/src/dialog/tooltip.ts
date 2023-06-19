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
    if (error) {
        messageElement.classList.add("tooltip--error");
    } else {
        messageElement.classList.remove("tooltip--error");
    }
    if (target.getAttribute("data-inline-memo-content")) {
        messageElement.classList.add("tooltip--memo"); // 为行级备注添加 class https://github.com/siyuan-note/siyuan/issues/6161
    }
    let left = targetRect.left;
    let topSpace = 8;
    const position = target.getAttribute("data-position");
    if (position === "right") {
        left = targetRect.right - messageElement.clientWidth;
    } else if (position === "center") {
        left = targetRect.left + (targetRect.width - messageElement.clientWidth) / 2;
    } else if (position === "top") {
        topSpace = 0;
    }
    setPosition(messageElement, left, targetRect.top + targetRect.height + topSpace, targetRect.height * 2 + 8);
};

export const hideTooltip = () => {
    const messageElement = document.getElementById("tooltip");
    if (messageElement) {
        messageElement.remove();
    }
};
