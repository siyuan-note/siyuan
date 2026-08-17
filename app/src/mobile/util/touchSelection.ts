export type TSelectionEndpoint = "anchor" | "focus";

export const hasVisibleSelectionText = (text: string) => text.replaceAll("\u200b", "").trim() !== "";

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
