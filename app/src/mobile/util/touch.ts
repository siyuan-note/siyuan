import {hasClosestByAttribute, hasClosestByClassName, hasTopClosestByClassName,} from "../../protyle/util/hasClosest";
import {closeModel, closePanel} from "./closePanel";
import {popMenu} from "../menu";
import {activeBlur} from "./keyboardToolbar";
import {isIPhone} from "../../protyle/util/compatibility";
import {App} from "../../index";
import {globalTouchEnd, globalTouchStart} from "../../boot/globalEvent/touch";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;
let time: number;
let firstDirection: "toLeft" | "toRight";
let firstXY: "x" | "y";
let lastClientX: number;    // 和起始方向不一致时，记录最后一次的 clientX
let scrollBlock: boolean;
let isFirstMove = true;

const popSide = (render = true) => {
    if (render) {
        document.getElementById("toolbarFile").dispatchEvent(new CustomEvent("click"));
    } else {
        activeBlur();
        document.getElementById("sidebar").style.transform = "translateX(0px)";
    }
};

export const handleTouchEnd = (event: TouchEvent, app: App) => {
    if (isIPhone() && globalTouchEnd(event, yDiff, time, app)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        return;
    }
    isFirstMove = true;
    const target = event.target as HTMLElement;
    if (!clientY || typeof yDiff === "undefined" ||
        target.tagName === "AUDIO" ||
        hasClosestByClassName(target, "b3-dialog", true) ||
        (window.siyuan.mobile.editor && !window.siyuan.mobile.editor.protyle.toolbar.subElement.classList.contains("fn__none")) ||
        hasClosestByClassName(target, "viewer-container") ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByAttribute(target, "id", "commonMenu")
    ) {
        return;
    }
    if (window.siyuan.mobile.editor) {
        window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "";
    }

    // 有些事件不经过 touchstart 和 touchmove，因此需设置为 null 不再继续执行
    clientX = null;
    // 有些事件不经过 touchmove

    if (scrollBlock) {
        closePanel();
        return;
    }

    let scrollEnable = false;
    if (new Date().getTime() - time < 1000) {
        scrollEnable = true;
    } else if (Math.abs(xDiff) > window.innerWidth / 3) {
        scrollEnable = true;
    }

    const isXScroll = Math.abs(xDiff) > Math.abs(yDiff);
    const modelElement = hasClosestByAttribute(target, "id", "model", true);
    if (modelElement) {
        if (isXScroll && firstDirection === "toRight" && !lastClientX) {
            closeModel();
        }
        return;
    }
    const menuElement = hasClosestByAttribute(target, "id", "menu");
    if (menuElement) {
        if (isXScroll) {
            if (firstDirection === "toRight") {
                if (lastClientX) {
                    popMenu();
                } else {
                    closePanel();
                }
            } else {
                if (lastClientX) {
                    closePanel();
                } else {
                    popMenu();
                }
            }
        } else {
            popMenu();
        }
        return;
    }
    const sideElement = hasClosestByAttribute(target, "id", "sidebar");
    if (sideElement) {
        if (isXScroll) {
            if (firstDirection === "toLeft") {
                if (lastClientX) {
                    popSide(false);
                } else {
                    closePanel();
                }
            } else {
                if (lastClientX) {
                    closePanel();
                } else {
                    popSide(false);
                }
            }
        } else {
            popSide(false);
        }
        return;
    }
    if (!scrollEnable || !isXScroll) {
        closePanel();
        return;
    }

    if (xDiff > 0) {
        if (lastClientX) {
            closePanel();
        } else {
            popMenu();
        }
    } else {
        if (lastClientX) {
            closePanel();
        } else {
            popSide();
        }
    }
};

export const handleTouchStart = (event: TouchEvent) => {
    if (0 < event.touches.length && ((event.touches[0].target as HTMLElement).tagName === "VIDEO" || (event.touches[0].target as HTMLElement).tagName === "AUDIO")) {
        // https://github.com/siyuan-note/siyuan/issues/14569
        activeBlur();
        return;
    }

    if (globalTouchStart(event)) {
        return;
    }
    firstDirection = null;
    xDiff = undefined;
    yDiff = undefined;
    lastClientX = undefined;
    firstXY = undefined;
    if (isIPhone() ||
        (event.touches[0].clientX > 8 && event.touches[0].clientX < window.innerWidth - 8)) {
        clientX = event.touches[0].clientX;
        clientY = event.touches[0].clientY;
        time = new Date().getTime();
    } else {
        clientX = null;
        clientY = null;
        time = 0;
        event.stopImmediatePropagation();
    }
    isFirstMove = true;
    scrollBlock = false;
};

let previousClientX: number;
const sideMaskElement = document.querySelector(".side-mask") as HTMLElement;
export const handleTouchMove = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    if (!clientX || !clientY ||
        target.tagName === "AUDIO" ||
        hasClosestByClassName(target, "b3-dialog", true) ||
        (window.siyuan.mobile.editor && !window.siyuan.mobile.editor.protyle.toolbar.subElement.classList.contains("fn__none")) ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByClassName(target, "viewer-container") ||
        hasClosestByAttribute(target, "id", "commonMenu") || firstXY === "y"
    ) {
        return;
    }

    // 正在编辑时禁止滑动
    if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none")) {
        return;
    }
    // 只读状态下选中内容时时禁止滑动
    if (getSelection().rangeCount > 0) {
        // 选中后扩选的情况
        const range = getSelection().getRangeAt(0);
        if (range.toString() !== "" && window.siyuan.mobile.editor.protyle.wysiwyg.element.contains(range.startContainer)) {
            return;
        }
    }

    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);
    if (!firstDirection) {
        firstDirection = xDiff > 0 ? "toLeft" : "toRight";
    }
    // 上下滚动防止左右滑动
    if (!firstXY) {
        if (Math.abs(xDiff) > Math.abs(yDiff)) {
            firstXY = "x";
        } else {
            firstXY = "y";
        }
        if (firstXY === "x") {
            if ((hasClosestByAttribute(target, "id", "menu") && firstDirection === "toLeft") ||
                (hasClosestByAttribute(target, "id", "sidebar") && firstDirection === "toRight")) {
                firstXY = "y";
                yDiff = undefined;
            }
        }
    }
    if (previousClientX) {
        if (firstDirection === "toRight") {
            if (previousClientX > event.touches[0].clientX) {
                lastClientX = event.touches[0].clientX;
            } else {
                lastClientX = undefined;
            }
        } else if (firstDirection === "toLeft") {
            if (previousClientX < event.touches[0].clientX) {
                lastClientX = event.touches[0].clientX;
            } else {
                lastClientX = undefined;
            }
        }
    }
    previousClientX = event.touches[0].clientX;
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (hasClosestByAttribute(target, "id", "model", true)) {
            return;
        }
        let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock") ||
            hasClosestByAttribute(target, "data-type", "NodeAttributeView") ||
            hasClosestByAttribute(target, "data-type", "NodeMathBlock") ||
            hasClosestByAttribute(target, "data-type", "NodeTable") ||
            hasTopClosestByClassName(target, "list") ||
            hasTopClosestByClassName(target, "protyle-breadcrumb__bar--nowrap");
        if (scrollElement) {
            if (scrollElement.classList.contains("table")) {
                scrollElement = scrollElement.firstElementChild as HTMLElement;
            } else if (scrollElement.classList.contains("code-block")) {
                scrollElement = scrollElement.firstElementChild.nextElementSibling as HTMLElement;
            } else if (scrollElement.classList.contains("av")) {
                scrollElement = hasClosestByClassName(target, "layout-tab-bar") || hasClosestByClassName(target, "av__scroll") ||
                    hasClosestByClassName(target, "av__kanban");
            } else if (scrollElement.dataset.type === "NodeMathBlock") {
                scrollElement = target;
                while (scrollElement && scrollElement.dataset.type !== "NodeMathBlock") {
                    if (scrollElement.nodeType === 1 && scrollElement.scrollLeft > 0) {
                        break;
                    }
                    scrollElement = scrollElement.parentElement;
                }
            }
            let noScroll = false;
            if (scrollElement && scrollElement.scrollLeft === 0) {
                scrollElement.scrollLeft = 1;
                if (scrollElement.scrollLeft === 0) {
                    noScroll = true;
                }
            }
            if (!noScroll) {
                if (scrollElement && (
                    (xDiff < 0 && scrollElement.scrollLeft > 0) ||
                    (xDiff > 0 && scrollElement.clientWidth + scrollElement.scrollLeft < scrollElement.scrollWidth)
                )) {
                    scrollBlock = true;
                    return;
                }
            }
            if (scrollBlock) {
                return;
            }
        }

        if (isFirstMove) {
            sideMaskElement.style.zIndex = (++window.siyuan.zIndex).toString();
            document.getElementById("sidebar").style.zIndex = (++window.siyuan.zIndex).toString();
            document.getElementById("menu").style.zIndex = (++window.siyuan.zIndex).toString();
            isFirstMove = false;
        }
        const windowWidth = window.innerWidth;
        const menuElement = hasClosestByAttribute(target, "id", "menu");
        if (menuElement) {
            if (xDiff < 0) {
                menuElement.style.transform = `translateX(${-xDiff}px)`;
                transformMask(-xDiff / windowWidth);
            } else {
                menuElement.style.transform = "translateX(0px)";
                transformMask(0);
            }
            return;
        }
        const sideElement = hasClosestByAttribute(target, "id", "sidebar");
        if (sideElement) {
            if (xDiff > 0) {
                sideElement.style.transform = `translateX(${-xDiff}px)`;
                transformMask(xDiff / windowWidth);
            } else {
                sideElement.style.transform = "translateX(0px)";
                transformMask(0);
            }
            return;
        }

        if (firstDirection === "toRight") {
            document.getElementById("sidebar").style.transform = `translateX(${Math.min(-xDiff - windowWidth, 0)}px)`;
            transformMask((windowWidth + xDiff) / windowWidth);
        } else {
            document.getElementById("menu").style.transform = `translateX(${Math.max(windowWidth - xDiff, 0)}px)`;
            transformMask((windowWidth - xDiff) / windowWidth);
        }
        activeBlur();
        if (window.siyuan.mobile.editor) {
            window.siyuan.mobile.editor.protyle.contentElement.style.overflow = "hidden";
        }
    }
};

const transformMask = (opacity: number) => {
    sideMaskElement.classList.remove("fn__none");
    sideMaskElement.style.opacity = Math.min((1 - opacity), 0.68).toString();
};
