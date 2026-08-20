export type TSelectionEndpoint = "anchor" | "focus";

// 返回值需与 Android 端 Utils 中的键盘隐藏结果保持一致。
export const KeyboardHideResult = {
    Cleanup: 0,
    PreserveSelection: 1,
    RestoreTableCellSelection: 2,
} as const;

const normalizeVisibleSelectionText = (text: string) => text.replaceAll("\u200b", "").trim();

export const hasVisibleSelectionText = (text: string) => normalizeVisibleSelectionText(text) !== "";

export const isTableCellSelectAll = (selectionText: string, cellText: string) => {
    const normalizedSelectionText = normalizeVisibleSelectionText(selectionText);
    return normalizedSelectionText !== "" && normalizedSelectionText === normalizeVisibleSelectionText(cellText);
};

export const shouldPreserveTableCellSelectAll = (expiresAt: number, now: number) => expiresAt >= now;

export const shouldHideKeyboardAfterResize = (isInputFocused: boolean, preserveTableCellSelectAll: boolean) =>
    !isInputFocused && !preserveTableCellSelectAll;

export const getKeyboardHideResult = (
    preserveSelection: boolean,
    tableCellSelectionRestored: boolean,
    hasVisibleEditorSelection: boolean,
) => {
    if (preserveSelection && tableCellSelectionRestored) {
        return KeyboardHideResult.RestoreTableCellSelection;
    }
    if (preserveSelection && hasVisibleEditorSelection) {
        return KeyboardHideResult.PreserveSelection;
    }
    return KeyboardHideResult.Cleanup;
};

export const getMovingSelectionEndpoint = (
    movingEndpoint: TSelectionEndpoint | undefined,
    anchorChanged: boolean,
    focusChanged: boolean,
) => {
    if (movingEndpoint || anchorChanged === focusChanged) {
        return movingEndpoint;
    }
    return anchorChanged ? "anchor" : "focus";
};

export const hasFixedSelectionEndpointChanged = (
    movingEndpoint: TSelectionEndpoint | undefined,
    anchorChanged: boolean,
    focusChanged: boolean,
) => movingEndpoint === "anchor" ? focusChanged : movingEndpoint === "focus" && anchorChanged;

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
