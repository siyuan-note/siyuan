import {openMobileFileById} from "../editor";

let clientX: number;
let clientY: number;
let xDiff: number;
let yDiff: number;

const forwardStack: IBackStack[] = [];
let previousIsBack = false;

export const handleTouchEnd = () => {
    if (window.siyuan.mobileEditor) {
        window.siyuan.mobileEditor.protyle.breadcrumb.show();
    }

    if (!clientX || !clientY || navigator.userAgent.indexOf("iPhone") === -1) {
        return;
    }

    if (Math.abs(xDiff) > Math.abs(yDiff) && Math.abs(xDiff) > window.innerWidth / 2) {
        if (xDiff > 0) {
            if (forwardStack.length === 0) {
                window.JSAndroid?.returnDesktop();
                return;
            }
            if (previousIsBack) {
                window.siyuan.backStack.push(forwardStack.pop());
            }
            const item = forwardStack.pop();
            item.scrollTop = window.siyuan.mobileEditor.protyle.contentElement.scrollTop;
            window.siyuan.backStack.push(item);
            openMobileFileById(item.id, item.callback, false);
            setTimeout(() => {
                window.siyuan.mobileEditor.protyle.contentElement.scrollTo({
                    top: window.siyuan.backStack[window.siyuan.backStack.length - 2]?.scrollTop || 0,
                    behavior: "smooth"
                });
            }, 200);
            previousIsBack = false;
        } else {
            // 后退
            if (window.siyuan.backStack.length === 0 || (window.siyuan.backStack.length === 1 && forwardStack.length === 0)) {
                window.JSAndroid?.returnDesktop();
                return;
            }
            if (!previousIsBack) {
                forwardStack.push(window.siyuan.backStack.pop());
            }
            const item = window.siyuan.backStack.pop();
            item.scrollTop = window.siyuan.mobileEditor.protyle.contentElement.scrollTop;
            forwardStack.push(item);
            openMobileFileById(item.id, item.callback, false);
            setTimeout(() => {
                window.siyuan.mobileEditor.protyle.contentElement.scrollTo({
                    top: forwardStack[forwardStack.length - 2]?.scrollTop || 0,
                    behavior: "smooth"
                });
            }, 200);
            previousIsBack = true;
        }
    }

    clientX = null;
    clientY = null;
};

export const handleTouchStart = (event: TouchEvent) => {
    xDiff = 0;
    yDiff = 0;
    clientX = event.touches[0].clientX;
    if ((clientX < 48 || clientX > window.innerWidth - 24) && document.querySelector(".scrim").classList.contains("fn__none")) {
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
