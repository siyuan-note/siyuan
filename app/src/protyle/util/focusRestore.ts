export const shouldFocusAfterZoom = (options: {
    focusId?: string,
    id: string,
    rootID: string,
    isPushBack: boolean,
}) => Boolean(options.focusId || (options.isPushBack && options.id !== options.rootID));

export const hasFocusOffsets = (scrollAttr?: IScrollAttr) => Boolean(scrollAttr?.focusId) &&
    typeof scrollAttr.focusStart === "number" && typeof scrollAttr.focusEnd === "number";

// 恢复光标时以持久化的页签选择为准，过期光标不能重新激活隐藏页。
export const getSavedTabFocusTarget = (element: Element): Element => {
    let target = element;
    for (let item = element?.closest(".tab-item"); item; item = item.parentElement?.closest(".tab-item")) {
        const tabs = item.parentElement;
        if (!tabs?.classList.contains("tabs")) {
            continue;
        }
        const items = Array.from(tabs.children).filter(child => child.classList.contains("tab-item"));
        const active = items.find(child => child.getAttribute("data-node-id") === tabs.getAttribute("tabs-active-id")) || items[0];
        if (active !== item) {
            target = tabs;
        }
    }
    return target;
};

export const getZoomFocusScrollAttr = (rootId: string, focusId?: string,
                                       focusPosition?: { start: number, end: number }): IScrollAttr | undefined =>
    focusId ? {
        rootId,
        focusId,
        focusStart: focusPosition?.start,
        focusEnd: focusPosition?.end,
    } : undefined;

export const getPendingBlockFocusMode = (value: string | null): "default" | "zoom" | undefined => {
    if (value === "zoom") {
        return "zoom";
    }
    if (value === "true") {
        return "default";
    }
};
