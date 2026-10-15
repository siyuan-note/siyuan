export const getGutterMarginHeight = (blockHeight: number, gutterHeight: number, naturalGutterHeight: number,
                                      editorFontSize: number) => {
    const lineHeight = Math.floor(editorFontSize * 1.625);
    if (blockHeight < lineHeight + 8 ||
        (blockHeight > lineHeight + 8 && blockHeight < lineHeight * 2 + 8)) {
        return (blockHeight - (naturalGutterHeight || gutterHeight)) / 2;
    }
};

export const getBacklinkGutterContentTop = (contentTop: number, panelTop?: number, titleBottom?: number) => {
    return Math.max(contentTop, panelTop ?? contentTop, titleBottom ?? contentTop);
};

export const getFixedGutterPosition = (viewportPosition: number, fixedContainerPosition?: number) => {
    return viewportPosition - (fixedContainerPosition ?? 0);
};

// 位移变换会让浮动面板和移动端抽屉成为固定定位块标的坐标参照。
export const getGutterFixedContainerRect = (element: HTMLElement) => {
    const container = element.closest(".layout--float, .mobile-bottom-sheet");
    if (container && getComputedStyle(container).transform !== "none") {
        return container.getBoundingClientRect();
    }
};

export const getContainerGutterSpace = (type: string, usesContainerRect: boolean) =>
    !usesContainerRect && ["NodeBlockquote", "NodeCallout"].includes(type) ? 10 : 0;

export const getListGutterAnchorLeft = (actionLeft: number, contentLeft: number, rtl: boolean) =>
    rtl ? contentLeft : actionLeft;
