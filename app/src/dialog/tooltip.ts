import {setPosition} from "../util/setPosition";
import {isMobile} from "../util/functions";

export const showTooltip = (message: string, target: Element) => {
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
    if(target.getAttribute("data-inline-memo-content")) {
        messageElement.classList.add("tooltip--memo"); // 为行级备注添加 class https://github.com/siyuan-note/siyuan/issues/6161
    }
    let left = targetRect.left;
    const position = target.getAttribute("data-position");
    if (position === "right") {
        left = targetRect.right - messageElement.clientWidth;
    } else if (position === "center") {
        left = targetRect.left + (targetRect.width - messageElement.clientWidth) / 2;
    }
    setPosition(messageElement, left, targetRect.top + targetRect.height + 8, targetRect.height * 2 + 8);
};

export const hideTooltip = () => {
    const messageElement = document.getElementById("tooltip");
    if (messageElement) {
        messageElement.remove();
    }
};
