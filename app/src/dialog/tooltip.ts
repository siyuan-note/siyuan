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

    const className = tooltipClass ? `tooltip tooltip--${tooltipClass}` : "tooltip";
    let messageElement = document.getElementById("tooltip");
    if (!messageElement) {
        document.body.insertAdjacentHTML("beforeend", `<div id="tooltip" class="${className}">${message}</div>`);
        messageElement = document.getElementById("tooltip");
    } else {
        let needsRemoveStyle = false;
        if (messageElement.className !== className) {
            messageElement.className = className;
            needsRemoveStyle = true;
        }
        if (messageElement.innerHTML !== message) {
            messageElement.innerHTML = message;
            needsRemoveStyle = true;
        }
        if (needsRemoveStyle) {
            // 避免原本的 top 和 left 影响计算
            Object.assign(messageElement.style, { top: "0", left: "0" });
        }
    }

    // position: parentE; parentW; ${number}parentW; ${number}bottom;
    // right; right${number}bottom; right${number}top; top;
    const position = target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();

    let top, left;

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
        top = targetRect.bottom + parseInt(position.replace("right", "").replace("left", ""));
    } else if (position?.endsWith("top")) {
        // 数据库视图、编辑器动态滚动条
        top = targetRect.top - messageElement.clientHeight;
    } else if (position === "west") {
        // 关联字段选项
        top = targetRect.top + (parseInt(position) || 0);
        left = targetRect.left - messageElement.clientWidth - 8;
    }

    top = top >= 0 ? top : targetRect.bottom;
    left = left >= 0 ? left : targetRect.left;

    const topHeight = position === "parentE" ? top : targetRect.top;
    const bottomHeight = window.innerHeight - top;

    messageElement.style.maxHeight = Math.max(topHeight, bottomHeight) + "px";

    if (top + messageElement.clientHeight > window.innerHeight && topHeight > bottomHeight) {
        messageElement.style.top = ((position === "parentE" || position === "west" ? parentRect.bottom : targetRect.top) - messageElement.clientHeight) + "px";
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
