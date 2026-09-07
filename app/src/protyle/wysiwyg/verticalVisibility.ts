// 滚动区域外的内容仍可通过滚动到达；隐藏裁剪与折叠区域则限制合法落点。
export const getReachableVerticalRects = (element: Element, rects: DOMRect[]) => {
    let result = rects.filter(rect => rect.height > 0.5);
    const view = element.ownerDocument?.defaultView;
    if (!view) {
        return result;
    }
    let ancestor: Element | null = element;
    while (ancestor && result.length > 0) {
        const style = view.getComputedStyle(ancestor);
        if (style.visibility === "hidden" || style.visibility === "collapse" || style.display === "none") {
            return [];
        }
        const clipX = ["hidden", "clip"].includes(style.overflowX);
        const clipY = ["hidden", "clip"].includes(style.overflowY);
        if (clipX || clipY) {
            const bounds = ancestor.getBoundingClientRect();
            result = result.flatMap(rect => {
                const left = clipX ? Math.max(rect.left, bounds.left) : rect.left;
                const right = clipX ? Math.min(rect.right, bounds.right) : rect.right;
                const top = clipY ? Math.max(rect.top, bounds.top) : rect.top;
                const bottom = clipY ? Math.min(rect.bottom, bounds.bottom) : rect.bottom;
                return right >= left && bottom - top > 0.5 ?
                    [new DOMRect(left, top, right - left, bottom - top)] : [];
            });
        }
        ancestor = ancestor.parentElement;
    }
    return result;
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
