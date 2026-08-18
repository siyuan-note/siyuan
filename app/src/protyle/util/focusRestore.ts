export const shouldFocusAfterZoom = (options: {
    focusId?: string,
    id: string,
    rootID: string,
    isPushBack: boolean,
}) => Boolean(options.focusId || (options.isPushBack && options.id !== options.rootID));

export const hasFocusOffsets = (scrollAttr?: IScrollAttr) => Boolean(scrollAttr?.focusId) &&
    typeof scrollAttr.focusStart === "number" && typeof scrollAttr.focusEnd === "number";

export const getPendingBlockFocusMode = (value: string | null): "default" | "zoom" | undefined => {
    if (value === "zoom") {
        return "zoom";
    }
    if (value === "true") {
        return "default";
    }
};
