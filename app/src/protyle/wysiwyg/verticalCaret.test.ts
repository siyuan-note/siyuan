import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCodeTrailingZeroWidthLineLimit,
    getHorizontalDistanceToRect,
    getNavigableVerticalRects,
    getRectsIntersectingVerticalLine,
    getRevealDelta,
    isCaretRectAtVerticalBoundary,
} from "./verticalGeometry";

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

    it("keeps zero-width visual lines navigable", () => {
        const rects = [rect(10), {...rect(30), right: 10, width: 0}];
        const navigableRects = getNavigableVerticalRects(rects);

        assert.equal(navigableRects.length, 2);
        assert.equal(isCaretRectAtVerticalBoundary(10, navigableRects, "down"), false);
        assert.equal(isCaretRectAtVerticalBoundary(30, navigableRects, "down"), true);
    });

    it("removes only the technical trailing line from code blocks", () => {
        const rects = [rect(10), {...rect(30), right: 10, width: 0}, {...rect(50), right: 10, width: 0}];
        const navigableRects = getNavigableVerticalRects(rects, 1);

        assert.deepEqual(navigableRects, rects.slice(0, 2));
    });

    it("keeps the only caret line of an empty code block", () => {
        const emptyLine = {...rect(10), right: 10, width: 0};

        assert.equal(getCodeTrailingZeroWidthLineLimit("\n"), 1);
        assert.deepEqual(getNavigableVerticalRects([emptyLine], getCodeTrailingZeroWidthLineLimit("\n")),
            [emptyLine]);
        assert.equal(getCodeTrailingZeroWidthLineLimit("x\n"), 0);
        assert.equal(getCodeTrailingZeroWidthLineLimit("x\n\n"), 1);
        assert.equal(getCodeTrailingZeroWidthLineLimit("\n\n\n"), 3);
    });

    it("accepts only range context rectangles that reach the target line", () => {
        const lines = [rect(30)];

        assert.deepEqual(getRectsIntersectingVerticalLine([rect(10)], lines), []);
        assert.deepEqual(getRectsIntersectingVerticalLine([rect(10, 40)], lines), [rect(10, 40)]);
        assert.deepEqual(getRectsIntersectingVerticalLine([{...rect(30), right: 10, width: 0}], lines),
            [{...rect(30), right: 10, width: 0}]);
    });

    it("calculates the nearest horizontal region and the required reveal distance", () => {
        assert.equal(getHorizontalDistanceToRect(30, rect(10)), 0);
        assert.equal(getHorizontalDistanceToRect(5, rect(10)), 5);
        assert.equal(getHorizontalDistanceToRect(120, rect(10)), 20);
        assert.equal(getRevealDelta(80, 100, 20, 120), 0);
        assert.equal(getRevealDelta(10, 30, 20, 120), -10);
        assert.equal(getRevealDelta(130, 150, 20, 120), 30);
    });
});
