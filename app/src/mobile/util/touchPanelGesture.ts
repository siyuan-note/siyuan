export type MobileSidebarSide = "left" | "right";
export type MobileSwipeDirection = "toLeft" | "toRight";
export type MobileSidebarReleaseAction = "close" | "open";

export const MOBILE_SIDEBAR_SWIPING_CLASS = "side-panel--swiping";
export const MOBILE_SIDEBAR_MASK_SWIPING_CLASS = "side-mask--swiping";

interface IMobileSidebarSwipeClassTarget {
    classList: {
        add(className: string): void;
        remove(className: string): void;
    };
}

export const setSidebarSwipeState = (
    sidebars: Partial<Record<MobileSidebarSide, IMobileSidebarSwipeClassTarget | null>>,
    mask: IMobileSidebarSwipeClassTarget | null,
    activeSide?: MobileSidebarSide,
) => {
    Object.values(sidebars).forEach(item => item?.classList.remove(MOBILE_SIDEBAR_SWIPING_CLASS));
    mask?.classList.remove(MOBILE_SIDEBAR_MASK_SWIPING_CLASS);
    const activeSidebar = activeSide ? sidebars[activeSide] : undefined;
    if (!activeSidebar) {
        return;
    }
    activeSidebar.classList.add(MOBILE_SIDEBAR_SWIPING_CLASS);
    mask?.classList.add(MOBILE_SIDEBAR_MASK_SWIPING_CLASS);
};

export const getOpeningSidebar = (direction: MobileSwipeDirection): MobileSidebarSide => {
    return direction === "toRight" ? "left" : "right";
};

export const getSidebarClosingDirection = (side: MobileSidebarSide): MobileSwipeDirection => {
    return side === "left" ? "toLeft" : "toRight";
};

export const shouldDragOpenSidebar = (side: MobileSidebarSide, direction: MobileSwipeDirection) => {
    return direction === getSidebarClosingDirection(side);
};

export const shouldCloseGlobalMenu = (direction: MobileSwipeDirection, reversing: boolean) => {
    return direction === "toRight" && !reversing;
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
