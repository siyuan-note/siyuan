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

export const getContainerGutterSpace = (type: string, usesContainerRect: boolean) =>
    !usesContainerRect && ["NodeBlockquote", "NodeCallout"].includes(type) ? 10 : 0;

export const getListGutterAnchorLeft = (actionLeft: number, contentLeft: number, rtl: boolean) =>
    rtl ? contentLeft : actionLeft;
