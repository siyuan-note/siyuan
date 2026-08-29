import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getOpeningSidebar,
    getOpenSidebarReleaseAction,
    getSidebarClosingDirection,
    getSidebarClosingOffset,
    getSidebarMaskOpacity,
    getSidebarOpeningOffset,
    MOBILE_SIDEBAR_MASK_MAX_OPACITY,
    MOBILE_SIDEBAR_MASK_SWIPING_CLASS,
    MOBILE_SIDEBAR_SWIPING_CLASS,
    setSidebarSwipeState,
    shouldCloseGlobalMenu,
    shouldDragOpenSidebar,
} from "./touchPanelGesture";

const createClassTarget = () => {
    const classes = new Set<string>();
    return {
        classes,
        target: {
            classList: {
                add(className: string) {
                    classes.add(className);
                },
                remove(className: string) {
                    classes.delete(className);
                },
            },
        },
    };
};

describe("mobile sidebar touch gesture", () => {
    it("opens the sidebar opposite the finger movement", () => {
        assert.equal(getOpeningSidebar("toRight"), "left");
        assert.equal(getOpeningSidebar("toLeft"), "right");
    });

    it("only starts an open sidebar drag toward its outer edge", () => {
        assert.equal(getSidebarClosingDirection("left"), "toLeft");
        assert.equal(getSidebarClosingDirection("right"), "toRight");
        assert.equal(shouldDragOpenSidebar("left", "toLeft"), true);
        assert.equal(shouldDragOpenSidebar("left", "toRight"), false);
        assert.equal(shouldDragOpenSidebar("right", "toRight"), true);
        assert.equal(shouldDragOpenSidebar("right", "toLeft"), false);
    });

    it("reopens a sidebar when a closing drag is pulled back", () => {
        assert.equal(getOpenSidebarReleaseAction("left", "toLeft", false), "close");
        assert.equal(getOpenSidebarReleaseAction("left", "toLeft", true), "open");
        assert.equal(getOpenSidebarReleaseAction("right", "toRight", false), "close");
        assert.equal(getOpenSidebarReleaseAction("right", "toRight", true), "open");
    });

    it("closes the global menu only for an unreversed swipe to the right", () => {
        assert.equal(shouldCloseGlobalMenu("toRight", false), true);
        assert.equal(shouldCloseGlobalMenu("toRight", true), false);
        assert.equal(shouldCloseGlobalMenu("toLeft", false), false);
    });

    it("mirrors and clamps closing transforms", () => {
        assert.equal(getSidebarClosingOffset("left", 120, 300), -120);
        assert.equal(getSidebarClosingOffset("left", -120, 300), 0);
        assert.equal(getSidebarClosingOffset("left", 400, 300), -300);
        assert.equal(getSidebarClosingOffset("right", -120, 300), 120);
        assert.equal(getSidebarClosingOffset("right", 120, 300), 0);
        assert.equal(getSidebarClosingOffset("right", -400, 300), 300);
    });

    it("mirrors and clamps opening transforms", () => {
        assert.equal(getSidebarOpeningOffset("left", -120, 300), -180);
        assert.equal(getSidebarOpeningOffset("left", 20, 300), -300);
        assert.equal(getSidebarOpeningOffset("left", -400, 300), 0);
        assert.equal(getSidebarOpeningOffset("right", 120, 300), 180);
        assert.equal(getSidebarOpeningOffset("right", -20, 300), 300);
        assert.equal(getSidebarOpeningOffset("right", 400, 300), 0);
    });

    it("dims the page gently in proportion to the open sidebar", () => {
        assert.equal(getSidebarMaskOpacity(1), 0);
        assert.equal(getSidebarMaskOpacity(0.5), MOBILE_SIDEBAR_MASK_MAX_OPACITY / 2);
        assert.equal(getSidebarMaskOpacity(0), MOBILE_SIDEBAR_MASK_MAX_OPACITY);
        assert.equal(getSidebarMaskOpacity(-1), MOBILE_SIDEBAR_MASK_MAX_OPACITY);
        assert.equal(getSidebarMaskOpacity(2), 0);
    });

    it("keeps only the active sidebar in the swiping state", () => {
        const left = createClassTarget();
        const right = createClassTarget();
        const mask = createClassTarget();
        const sidebars = {left: left.target, right: right.target};

        setSidebarSwipeState(sidebars, mask.target, "left");
        assert.equal(left.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), true);
        assert.equal(right.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), false);
        assert.equal(mask.classes.has(MOBILE_SIDEBAR_MASK_SWIPING_CLASS), true);

        setSidebarSwipeState(sidebars, mask.target, "right");
        assert.equal(left.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), false);
        assert.equal(right.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), true);
        assert.equal(mask.classes.has(MOBILE_SIDEBAR_MASK_SWIPING_CLASS), true);
    });

    it("clears the swiping state when a gesture finishes", () => {
        const left = createClassTarget();
        const right = createClassTarget();
        const mask = createClassTarget();
        const sidebars = {left: left.target, right: right.target};

        setSidebarSwipeState(sidebars, mask.target, "left");
        setSidebarSwipeState(sidebars, mask.target);
        assert.equal(left.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), false);
        assert.equal(right.classes.has(MOBILE_SIDEBAR_SWIPING_CLASS), false);
        assert.equal(mask.classes.has(MOBILE_SIDEBAR_MASK_SWIPING_CLASS), false);
    });
});
