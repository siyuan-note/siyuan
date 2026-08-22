import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getOpeningSidebar,
    getOpenSidebarReleaseAction,
    getSidebarClosingDirection,
    getSidebarClosingOffset,
    getSidebarOpeningOffset,
    shouldDragOpenSidebar,
} from "./touchPanelGesture";

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
});
