import {goBack, goForward} from "./MobileBackFoward";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;

export const handleTouchEnd = () => {
    if (window.siyuan.mobile.editor) {
        document.querySelectorAll(".protyle-breadcrumb__bar--hide").forEach(item => {
            item.classList.remove("protyle-breadcrumb__bar--hide");
        });
        window.siyuan.hideBreadcrumb = false;
    }

    if (!clientX || !clientY || navigator.userAgent.indexOf("iPhone") === -1) {
        return;
    }

    if (Math.abs(xDiff) > Math.abs(yDiff) && Math.abs(xDiff) > window.innerWidth / 4) {
        if (xDiff > 0) {
            goForward();
        } else {
            // 后退
            goBack();
        }
    }

    clientX = null;
    clientY = null;
};

export const handleTouchStart = (event: TouchEvent) => {
    xDiff = 0;
    yDiff = 0;
    clientX = event.touches[0].clientX;
    if ((clientX < 48 || clientX > window.innerWidth - 24)) {
        clientY = event.touches[0].clientY;
    } else {
        clientX = null;
        clientY = null;
        event.stopImmediatePropagation();
    }
};

export const handleTouchMove = (event: TouchEvent) => {
    if (!clientX || !clientY) return;
    xDiff = Math.floor(clientX - event.touches[0].clientX);
    yDiff = Math.floor(clientY - event.touches[0].clientY);
    // TODO 动画效果
    if (Math.abs(xDiff) > Math.abs(yDiff)) {
        if (xDiff < 0) {
            // "left->right"
        } else {
            // "right->left"
        }
    }
};
