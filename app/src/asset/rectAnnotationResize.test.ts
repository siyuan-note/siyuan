import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {resizeRectBounds} from "./rectAnnotationResize";

const initial = {left: 20, top: 30, right: 80, bottom: 90};
const boundary = {left: 0, top: 0, right: 100, bottom: 120};

describe("rectangle annotation resizing", () => {
    it("resizes each rectangle corner", () => {
        assert.deepEqual(resizeRectBounds(initial, boundary, "nw", 10, 15, 8),
            {left: 10, top: 15, right: 80, bottom: 90});
        assert.deepEqual(resizeRectBounds(initial, boundary, "ne", 95, 15, 8),
            {left: 20, top: 15, right: 95, bottom: 90});
        assert.deepEqual(resizeRectBounds(initial, boundary, "sw", 10, 110, 8),
            {left: 10, top: 30, right: 80, bottom: 110});
        assert.deepEqual(resizeRectBounds(initial, boundary, "se", 95, 110, 8),
            {left: 20, top: 30, right: 95, bottom: 110});
    });

    it("keeps resized rectangles within the page", () => {
        assert.deepEqual(resizeRectBounds(initial, boundary, "nw", -20, -10, 8),
            {left: 0, top: 0, right: 80, bottom: 90});
        assert.deepEqual(resizeRectBounds(initial, boundary, "se", 130, 150, 8),
            {left: 20, top: 30, right: 100, bottom: 120});
    });

    it("preserves the minimum rectangle size", () => {
        assert.deepEqual(resizeRectBounds(initial, boundary, "nw", 78, 88, 8),
            {left: 72, top: 82, right: 80, bottom: 90});
        assert.deepEqual(resizeRectBounds(initial, boundary, "se", 22, 32, 8),
            {left: 20, top: 30, right: 28, bottom: 38});
    });
});
