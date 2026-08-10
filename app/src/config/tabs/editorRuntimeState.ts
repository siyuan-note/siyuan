type BacklinkExpandConfig = Pick<Config.IEditor, "backlinkExpandCount" | "backmentionExpandCount">;

export const shouldResetBottomBacklinkPanel = (current: BacklinkExpandConfig, next: BacklinkExpandConfig) => {
    return current.backlinkExpandCount !== next.backlinkExpandCount ||
        current.backmentionExpandCount !== next.backmentionExpandCount;
};
