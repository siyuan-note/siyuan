export const getAVVerticalNavigationAction = (hasAdjacentItem: boolean) =>
    hasAdjacentItem ? "move" as const : "leave" as const;
