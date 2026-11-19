import {isInMobileApp, isIOSDevice} from "../../protyle/util/compatibility";

// iOS WebView 可以通过可见视口反映键盘遮挡，布局视口仍保持原高度。
export const getMobileVisualViewport = () => !isInMobileApp() || isIOSDevice() ? window.visualViewport : undefined;

export const getVisibleViewportBounds = () => {
    const viewport = getMobileVisualViewport();
    if (viewport) {
        const top = Math.max(0, Math.min(window.innerHeight, viewport.offsetTop));
        return {
            top,
            bottom: Math.max(top, Math.min(window.innerHeight, viewport.offsetTop + viewport.height)),
        };
    }
    return {
        top: 0,
        bottom: window.innerHeight,
    };
};

export const scrollInputIntoView = (element: Element) => {
    if (!element.isConnected || document.activeElement !== element) {
        return;
    }
    const viewport = getVisibleViewportBounds();
    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
        if (/^(auto|scroll)$/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
            const parentRect = parent.getBoundingClientRect();
            const top = Math.max(viewport.top, parentRect.top + parent.clientTop);
            const bottom = Math.min(viewport.bottom, parentRect.top + parent.clientTop + parent.clientHeight);
            const rect = element.getBoundingClientRect();
            if (bottom <= top) {
                return;
            }
            // 只滚动输入框所在的容器，避免将弹窗和页面一起上移；高于可见区域的输入框保留当前位置。
            if (rect.top < top && rect.bottom < bottom) {
                parent.scrollTop += Math.max(rect.top - top, rect.bottom - bottom);
            } else if (rect.bottom > bottom && rect.top > top) {
                parent.scrollTop += Math.min(rect.bottom - bottom, rect.top - top);
            }
            return;
        }
        parent = parent.parentElement;
    }
};
