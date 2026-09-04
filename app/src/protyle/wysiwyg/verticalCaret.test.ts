import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isCaretRectAtVerticalBoundary} from "./verticalGeometry";

const rect = (top: number, height = 20) => ({
    top,
    bottom: top + height,
    left: 10,
    right: 100,
    height,
    width: 90,
});

describe("vertical caret boundary", () => {
    it("recognizes the first and last visual lines", () => {
        const rects = [rect(10), rect(30), rect(50)];

        assert.equal(isCaretRectAtVerticalBoundary(10, rects, "up"), true);
        assert.equal(isCaretRectAtVerticalBoundary(50, rects, "down"), true);
        assert.equal(isCaretRectAtVerticalBoundary(30, rects, "up"), false);
        assert.equal(isCaretRectAtVerticalBoundary(30, rects, "down"), false);
    });

    it("allows small browser differences in collapsed caret geometry", () => {
        const rects = [rect(10, 18), rect(28, 18)];

        assert.equal(isCaretRectAtVerticalBoundary(12, rects, "up"), true);
        assert.equal(isCaretRectAtVerticalBoundary(34, rects, "down"), true);
    });

    it("treats an empty editable region as both vertical boundaries", () => {
        assert.equal(isCaretRectAtVerticalBoundary(0, [], "up"), true);
        assert.equal(isCaretRectAtVerticalBoundary(0, [], "down"), true);
    });
});
