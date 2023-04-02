import {hasClosestByAttribute, hasClosestByClassName} from "../../protyle/util/hasClosest";
import {closePanel} from "./closePanel";
import {popMenu} from "../menu";
import {activeBlur, hideKeyboardToolbar} from "./keyboardToolbar";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;
let time: number;
let firstDirection: "toLeft" | "toRight";
let lastClientX: number;    // 和起始方向不一致时，记录最后一次的 clientX

const popSide = (render = true) => {
    if (render) {
        document.getElementById("toolbarFile").dispatchEvent(new CustomEvent("click"));
    } else {
        hideKeyboardToolbar();
        activeBlur();
        document.getElementById("sidebar").style.left = "0";
    }
};

export const handleTouchEnd = (event: TouchEvent) => {
    if (window.siyuan.mobile.editor) {
        document.querySelectorAll(".protyle-breadcrumb__bar--hide").forEach(item => {
            item.classList.remove("protyle-breadcrumb__bar--hide");
        });
        window.siyuan.hideBreadcrumb = false;
    }

    const target = event.target as HTMLElement;
    if (!clientX || !clientY || typeof yDiff === "undefined" ||
        hasClosestByClassName(target, "b3-dialog") ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByAttribute(target, "id", "model")
    ) {
        return;
    }

    // 有些事件不经过 touchstart 和 touchmove，因此需设置为 null 不再继续执行
    clientX = null;
    // 有些事件不经过 touchmove

    let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock") || hasClosestByAttribute(target, "data-type", "NodeTable");
    if (scrollElement) {
        scrollElement = scrollElement.classList.contains("table") ? (scrollElement.firstElementChild as HTMLElement) : (scrollElement.firstElementChild.nextElementSibling as HTMLElement);
        if ((xDiff <= 0 && scrollElement.scrollLeft > 0) ||
            (xDiff >= 0 && scrollElement.clientWidth + scrollElement.scrollLeft < scrollElement.scrollWidth)) {
            return;
        }
    }

    let scrollEnable = false;
    if (new Date().getTime() - time < 1000) {
        scrollEnable = true;
    } else if (Math.abs(xDiff) > window.innerWidth / 3) {
        scrollEnable = true;
    }

    const isXScroll = Math.abs(xDiff) > Math.abs(yDiff);
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
    firstDirection = null;
    xDiff = undefined;
    yDiff = undefined;
    lastClientX = undefined;
    if (navigator.userAgent.indexOf("iPhone") > -1 ||
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
};


let previousClientX: number;
export const handleTouchMove = (event: TouchEvent) => {
    const target = event.target as HTMLElement;
    if (!clientX || !clientY ||
        hasClosestByClassName(target, "b3-dialog") ||
        hasClosestByClassName(target, "keyboard") ||
        hasClosestByAttribute(target, "id", "model")) {
        return;
    }

    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);
    if (!firstDirection) {
        firstDirection = xDiff > 0 ? "toLeft" : "toRight";
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
        let scrollElement = hasClosestByAttribute(target, "data-type", "NodeCodeBlock") || hasClosestByAttribute(target, "data-type", "NodeTable");
        if (scrollElement) {
            scrollElement = scrollElement.classList.contains("table") ? (scrollElement.firstElementChild as HTMLElement) : (scrollElement.firstElementChild.nextElementSibling as HTMLElement);
            if ((xDiff < 0 && scrollElement.scrollLeft > 0) ||
                (xDiff > 0 && scrollElement.clientWidth + scrollElement.scrollLeft < scrollElement.scrollWidth)) {
                return;
            }
        }

        const windowWidth = window.innerWidth;
        const menuElement = hasClosestByAttribute(target, "id", "menu");
        if (menuElement) {
            if (xDiff < 0) {
                menuElement.style.right = xDiff + "px";
                transformMask(-xDiff / windowWidth);
            } else {
                menuElement.style.right = "0px";
                transformMask(0);
            }
            return;
        }
        const sideElement = hasClosestByAttribute(target, "id", "sidebar");
        if (sideElement) {
            if (xDiff > 0) {
                sideElement.style.left = -xDiff + "px";
                transformMask(xDiff / windowWidth);
            } else {
                sideElement.style.left = "0px";
                transformMask(0);
            }
            return;
        }
        if (firstDirection === "toRight") {
            document.getElementById("sidebar").style.left = -windowWidth - xDiff + "px";
            transformMask((windowWidth + xDiff) / windowWidth);
        } else {
            document.getElementById("menu").style.right = -windowWidth + xDiff + "px";
            transformMask((windowWidth - xDiff) / windowWidth);
        }
    }
};

const transformMask = (opacity: number) => {
    const maskElement = document.querySelector(".side-mask") as HTMLElement;
    maskElement.classList.remove("fn__none");
    maskElement.style.opacity = Math.min((1 - opacity), 0.86).toString();
};
