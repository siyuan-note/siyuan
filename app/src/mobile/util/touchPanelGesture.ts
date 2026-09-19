export type MobileSidebarSide = "left" | "right";
export type MobileSwipeDirection = "toLeft" | "toRight";

export const MOBILE_SIDEBAR_SWIPE_ACTIVATION_DISTANCE = 12;
export const MOBILE_SIDEBAR_SWIPE_MIN_FLING_DISTANCE = 32;
export const MOBILE_SIDEBAR_SWIPE_MIN_FLING_VELOCITY = 0.3;
export const MOBILE_SIDEBAR_SWIPE_SETTLE_RATIO = 1 / 3;

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

export const shouldCommitSidebarSwipe = (
    direction: MobileSwipeDirection,
    xDiff: number,
    duration: number,
    width: number,
) => {
    const distance = direction === "toRight" ? -xDiff : xDiff;
    if (distance <= 0) {
        return false;
    }
    if (distance >= width * MOBILE_SIDEBAR_SWIPE_SETTLE_RATIO) {
        return true;
    }
    const velocity = duration > 0 ? distance / duration : Number.POSITIVE_INFINITY;
    return distance >= MOBILE_SIDEBAR_SWIPE_MIN_FLING_DISTANCE &&
        velocity >= MOBILE_SIDEBAR_SWIPE_MIN_FLING_VELOCITY;
};
