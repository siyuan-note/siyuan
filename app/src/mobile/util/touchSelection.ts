export const hasVisibleSelectionText = (text: string) => text.replaceAll("\u200b", "").trim() !== "";

export const shouldRestoreLongPressSelection = (
    collapsed: boolean,
    text: string,
    startBlockID: string | undefined,
    endBlockID: string | undefined,
    longPressBlockID: string | undefined,
) => !collapsed && !hasVisibleSelectionText(text) &&
    !!startBlockID && !!endBlockID && !!longPressBlockID &&
    startBlockID !== endBlockID &&
    (startBlockID === longPressBlockID || endBlockID === longPressBlockID);
