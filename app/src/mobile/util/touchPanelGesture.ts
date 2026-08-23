export type MobileSidebarSide = "left" | "right";
export type MobileSwipeDirection = "toLeft" | "toRight";
export type MobileSidebarReleaseAction = "close" | "open";

export const getOpeningSidebar = (direction: MobileSwipeDirection): MobileSidebarSide => {
    return direction === "toRight" ? "left" : "right";
};

export const getSidebarClosingDirection = (side: MobileSidebarSide): MobileSwipeDirection => {
    return side === "left" ? "toLeft" : "toRight";
};

export const shouldDragOpenSidebar = (side: MobileSidebarSide, direction: MobileSwipeDirection) => {
    return direction === getSidebarClosingDirection(side);
};

export const getOpenSidebarReleaseAction = (
    side: MobileSidebarSide,
    firstDirection: MobileSwipeDirection,
    reversing: boolean,
): MobileSidebarReleaseAction => {
    const closing = shouldDragOpenSidebar(side, firstDirection);
    return closing !== reversing ? "close" : "open";
};

export const getSidebarClosingOffset = (side: MobileSidebarSide, xDiff: number, width: number) => {
    if (side === "left") {
        return Math.max(Math.min(-xDiff, 0), -width);
    }
    return Math.min(Math.max(-xDiff, 0), width);
};

export const getSidebarOpeningOffset = (side: MobileSidebarSide, xDiff: number, width: number) => {
    if (side === "left") {
        return Math.min(Math.max(-xDiff - width, -width), 0);
    }
    return Math.max(Math.min(width - xDiff, width), 0);
};
