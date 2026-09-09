import {getRevealDelta} from "./verticalGeometry";

// 逻辑解析保留原始矩形，并用可滚动到达的投影检查外层裁剪；展示后只接受当前可见的矩形。
export const getReachableVerticalRects = (element: Element, rects: DOMRect[], requireVisible = false) => {
    let result = rects.filter(rect => rect.height > 0.5).map(rect => ({original: rect, rect}));
    const view = element.ownerDocument?.defaultView;
    if (!view) {
        return result.map(item => item.rect);
    }
    let ancestor: Element | null = element;
    while (ancestor && result.length > 0) {
        const style = view.getComputedStyle(ancestor);
        if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") {
            return [];
        }
        const scrollX = ["auto", "scroll", "overlay"].includes(style.overflowX);
        const scrollY = ["auto", "scroll", "overlay"].includes(style.overflowY);
        const clipX = scrollX || ["hidden", "clip"].includes(style.overflowX);
        const clipY = scrollY || ["hidden", "clip"].includes(style.overflowY);
        if (clipX || clipY) {
            const bounds = ancestor.getBoundingClientRect();
            const viewportLeft = bounds.left + ancestor.clientLeft;
            const viewportTop = bounds.top + ancestor.clientTop;
            const viewportRight = viewportLeft + ancestor.clientWidth;
            const viewportBottom = viewportTop + ancestor.clientHeight;
            result = result.flatMap(({original, rect}) => {
                let deltaX = 0;
                let deltaY = 0;
                if (!requireVisible && scrollX) {
                    const maxScroll = ancestor.scrollWidth - ancestor.clientWidth;
                    const minScroll = style.direction === "rtl" ? -maxScroll : 0;
                    deltaX = Math.max(minScroll, Math.min(minScroll + maxScroll, ancestor.scrollLeft +
                        getRevealDelta(rect.left, rect.right, viewportLeft, viewportRight))) - ancestor.scrollLeft;
                }
                if (!requireVisible && scrollY) {
                    deltaY = Math.max(0, Math.min(ancestor.scrollHeight - ancestor.clientHeight, ancestor.scrollTop +
                        getRevealDelta(rect.top, rect.bottom, viewportTop, viewportBottom))) - ancestor.scrollTop;
                }
                const left = clipX ? Math.max(rect.left - deltaX, viewportLeft) : rect.left;
                const right = clipX ? Math.min(rect.right - deltaX, viewportRight) : rect.right;
                const top = clipY ? Math.max(rect.top - deltaY, viewportTop) : rect.top;
                const bottom = clipY ? Math.min(rect.bottom - deltaY, viewportBottom) : rect.bottom;
                return right >= left && bottom - top > 0.5 ?
                    [{original, rect: new DOMRect(left, top, right - left, bottom - top)}] : [];
            });
        }
        ancestor = ancestor.parentElement;
    }
    return result.map(item => requireVisible ? item.rect : item.original);
};

export const getFoldedNavigationOwner = (element: Element) => {
    let owner: Element | undefined;
    let ancestor: Element | null = element;
    while (ancestor && !ancestor.classList.contains("protyle-wysiwyg")) {
        if (ancestor.getAttribute("fold") === "1") {
            owner = ancestor;
        }
        ancestor = ancestor.parentElement;
    }
    return owner;
};
