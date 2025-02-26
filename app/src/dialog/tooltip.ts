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

    const tooltipElement = document.getElementById("tooltip");
    const clonedTooltip = tooltipElement.cloneNode(true) as HTMLElement;
    clonedTooltip.id  = "clonedTooltip";
    clonedTooltip.removeAttribute("style");
    clonedTooltip.className = "tooltip";
    clonedTooltip.innerHTML = message;
    document.body.append(clonedTooltip);

    // position: parentE; parentW; ${number}parentW; ${number}bottom;
    // right; right${number}bottom; right${number}top; top;
    const position = target.getAttribute("data-position");
    const parentRect = target.parentElement.getBoundingClientRect();

    let top, left;

    if (position?.startsWith("right")) {
        // block icon and background icon
        left = targetRect.right - clonedTooltip.clientWidth + 1;
    }

    if (position === "parentE") {
        // file tree and outline、backlink
        top = parentRect.top;
        left = parentRect.right + 8;
    } else if (position?.endsWith("parentW")) {
        // 数据库属性视图
        top = parentRect.top + (parseInt(position) || 8);
        left = parentRect.left - clonedTooltip.clientWidth;
    } else if (position?.endsWith("bottom")) {
        top = targetRect.bottom + parseInt(position.replace("right", "")) + 1;
    } else if (position?.endsWith("top")) {
        // 数据库视图、编辑器动态滚动条
        top = targetRect.top - clonedTooltip.clientHeight - 1;
    } else if (position === "directLeft") {
        // 关联字段选项
        top = targetRect.top + (parseInt(position) || 0);
        left = targetRect.left - clonedTooltip.clientWidth - 8 - 1;
    }

    top = top >= 0 ? top : targetRect.bottom + 1;
    left = left >= 0 ? left : targetRect.left;

    const topHeight = position === "parentE" ? top : targetRect.top;
    const bottomHeight = window.innerHeight - top;

    clonedTooltip.style.maxHeight = Math.max(topHeight, bottomHeight) + "px";

    if (top + clonedTooltip.clientHeight > window.innerHeight && topHeight > bottomHeight) {
        top = (position === "parentE" || position === "directLeft" ? parentRect.bottom : targetRect.top) - clonedTooltip.clientHeight - 1;
    }

    if (left + clonedTooltip.clientWidth > window.innerWidth) {
        if (position === "parentE") {
            left = parentRect.left - 8 - clonedTooltip.clientWidth - 1;
        } else {
            left = window.innerWidth - 1 - clonedTooltip.clientWidth;
        }
    }

    // 确保不会超出屏幕
    if (top < 0 || left < 0) {
        top = targetRect.bottom + 1;
        left = targetRect.left;
    }

    clonedTooltip.style.top = top + "px";
    clonedTooltip.style.left = left + "px";

    const cloneStyle = clonedTooltip.getAttribute("style");
    const className = tooltipClass ? `tooltip tooltip--${tooltipClass}` : "tooltip";

    if (tooltipElement.getAttribute("style") !== cloneStyle) {
        tooltipElement.setAttribute("style", cloneStyle);
    }
    if (tooltipElement.className !== className) {
        tooltipElement.className = className;
    }
    if (tooltipElement.innerHTML !== clonedTooltip.innerHTML) {
        tooltipElement.innerHTML = clonedTooltip.innerHTML;
    }

    clonedTooltip.remove();
};

export const hideTooltip = () => {
    const tooltipElement = document.getElementById("tooltip");
    if (tooltipElement && !tooltipElement.classList.contains("fn__none")) {
        tooltipElement.classList.add("fn__none");
    }
};
