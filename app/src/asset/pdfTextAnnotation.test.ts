import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {isPdfRectAnnotation, mergePdfTextAnnotationRects, mergeTextAnnotationRects} from "./pdfTextAnnotation";

describe("PDF text annotation rectangles", () => {
    it("removes nested rectangles and joins adjacent fragments modeled on the issue 19310 screenshot", () => {
        const coords = [
            [286, 190, 483, 244],
            [487, 190, 1119, 244],
            [487, 199, 1119, 234],
            [87, 259, 521, 312],
            [87, 268, 521, 302],
            [527, 259, 1119, 312],
            [527, 268, 1119, 302],
            [87, 327, 483, 381],
            [87, 336, 483, 371],
            [483, 327, 723, 381],
        ];
        const original = structuredClone(coords);
        const result = mergePdfTextAnnotationRects(coords);
        assert.deepEqual(result, [
            [286, 190, 1119, 244],
            [87, 259, 1119, 312],
            [87, 327, 723, 381],
        ]);
        assert.deepEqual(coords, original);
        assert.deepEqual(mergePdfTextAnnotationRects(result), result);
    });

    it("keeps the full bounds when duplicates and right-to-left fragments arrive out of order", () => {
        assert.deepEqual(mergePdfTextAnnotationRects([
            [30, 20, 60, 0],
            [60, 0, 30, 20],
            [0, 1, 35, 21],
            [5, 4, 20, 16],
        ]), [[0, 0, 60, 21]]);
    });

    it("rechecks earlier fragments when a connecting rectangle arrives last", () => {
        assert.deepEqual(mergePdfTextAnnotationRects([
            [0, 0, 10, 10],
            [20, 0, 30, 10],
            [10, 0, 20, 10],
        ]), [[0, 0, 30, 10]]);
    });

    it("preserves separate lines, columns and gaps wider than text fragment spacing", () => {
        const coords = [
            [0, 0, 30, 10],
            [0, 8, 30, 18],
            [0, 18, 30, 28],
            [50, 0, 80, 10],
            [84, 0, 94, 10],
        ];
        assert.deepEqual(mergePdfTextAnnotationRects(coords), coords);
    });

    it("joins the small fragment gaps modeled on the follow-up screenshot at every scale", () => {
        const coords = [
            [106, 34, 192, 56], [194, 34, 467, 56],
            [20, 64, 209, 86], [212, 64, 467, 86],
            [20, 94, 191, 116], [194, 94, 294, 116],
        ];
        const expected = [[106, 34, 467, 56], [20, 64, 467, 86], [20, 94, 294, 116]];
        [0.25, 0.5, 1, 2, 4].forEach(scale => {
            assert.deepEqual(mergePdfTextAnnotationRects(coords.map(rect => rect.map(value => value * scale))),
                expected.map(rect => rect.map(value => value * scale)));
        });
    });

    it("handles different text heights without losing the lower or left edge", () => {
        assert.deepEqual(mergePdfTextAnnotationRects([
            [20, 2, 50, 18],
            [0, 0, 30, 20],
        ]), [[0, 0, 50, 20]]);
    });

    it("produces the same geometry at different scales", () => {
        const coords = [[0, 0, 30, 20], [20, 1, 50, 21], [0, 30, 50, 50]];
        const expected = [[0, 0, 50, 21], [0, 30, 50, 50]];
        [0.25, 0.5, 1, 2, 4].forEach(scale => {
            assert.deepEqual(mergePdfTextAnnotationRects(coords.map(rect => rect.map(value => value * scale))),
                expected.map(rect => rect.map(value => value * scale)));
        });
    });

    it("preserves input reading order for scrolling to existing annotations", () => {
        assert.deepEqual(mergePdfTextAnnotationRects([
            [0, 100, 20, 120],
            [0, 50, 20, 70],
            [20, 100, 40, 120],
        ]), [[0, 100, 40, 120], [0, 50, 20, 70]]);
    });

    it("ignores empty and non-finite rectangles without changing valid input", () => {
        assert.deepEqual(mergePdfTextAnnotationRects([
            [0, 0, 0, 20], [0, 0, 20, 0], [0, 0, NaN, 10], [0, 0, Infinity, 10],
            [10, 20, 30, 40],
        ]), [[10, 20, 30, 40]]);
        assert.deepEqual(mergeTextAnnotationRects([]), []);
    });

    it("recognizes legacy rectangle annotations before text rectangles are merged", () => {
        const content = "example-P2-20260911123456-abcdefg";
        assert.equal(isPdfRectAnnotation("rect", 1, "custom name"), true);
        assert.equal(isPdfRectAnnotation("", 1, content), true);
        assert.equal(isPdfRectAnnotation(undefined, 1, content), true);
        assert.equal(isPdfRectAnnotation("", 2, content), false);
        assert.equal(isPdfRectAnnotation("text", 1, content), false);
        assert.equal(isPdfRectAnnotation("", 1, "selected text"), false);
    });
});
