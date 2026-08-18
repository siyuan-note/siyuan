import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getRectImageName, hideRectResizeHandles, moveRectBounds, resizeRectBounds} from "./rectAnnotationResize";

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

    it("removes resize handles when the PDF selection is cleared", () => {
        let selectedClassRemoved = false;
        let handleRemoved = false;
        const selected = {
            classList: {
                remove(className: string) {
                    selectedClassRemoved = className === "pdf__rect--selected";
                },
            },
            querySelectorAll(selector: string) {
                assert.equal(selector, ".pdf__rect-resize");
                return [{remove: () => {
                    handleRemoved = true;
                }}];
            },
        };
        const container = {
            querySelectorAll(selector: string) {
                assert.equal(selector, ".pdf__rect--selected");
                return [selected];
            },
        } as unknown as ParentNode;

        hideRectResizeHandles(container);

        assert.equal(selectedClassRemoved, true);
        assert.equal(handleRemoved, true);
    });

    it("moves a rectangle without changing its size", () => {
        assert.deepEqual(moveRectBounds(initial, boundary, 10, 15),
            {left: 30, top: 45, right: 90, bottom: 105});
    });

    it("keeps moved rectangles within the page", () => {
        assert.deepEqual(moveRectBounds(initial, boundary, -50, -60),
            {left: 0, top: 0, right: 60, bottom: 60});
        assert.deepEqual(moveRectBounds(initial, boundary, 80, 90),
            {left: 40, top: 60, right: 100, bottom: 120});
    });

    it("uses the rectangle position hash in copied image names", () => {
        const content = "example-P1-20260809120000-abcdefg";
        assert.equal(getRectImageName(content, 0, "0123456", "capture-v2"),
            "example-P1-capture-v2-20260809120000-0123456.png");
        assert.equal(getRectImageName(content, 90, "7654321", "capture-v2"),
            "example-P1-90-capture-v2-20260809120000-7654321.png");
        assert.equal(getRectImageName(content, 0, "", "capture-v2"),
            "example-P1-capture-v2-20260809120000-abcdefg.png");
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
