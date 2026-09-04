export const getAVVerticalNavigationAction = (hasAdjacentItem: boolean) =>
    hasAdjacentItem ? "move" as const : "leave" as const;

export const shouldPreserveAVSelectionOnKeyup = (key: string, isFocusedInAV: boolean) =>
    key.startsWith("Arrow") && isFocusedInAV;

export const shouldRunAVKeyupFallback = (preventKeyup: boolean, isArrowFromOutsideAV: boolean) =>
    !preventKeyup && isArrowFromOutsideAV;
