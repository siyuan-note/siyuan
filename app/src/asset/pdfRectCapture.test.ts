import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getCaptureCanvasBounds,
    getCaptureDisplayWidth,
    getLimitedCaptureScale,
    normalizePdfRect,
    PDF_RECT_CAPTURE_MAX_EDGE,
    PDF_RECT_CAPTURE_MAX_PIXELS,
    PDF_RECT_CAPTURE_SCALE,
} from "./pdfRectCapture";

describe("PDF rectangle capture", () => {
    it("normalizes viewport rectangles in every coordinate direction", () => {
        assert.deepEqual(normalizePdfRect([80, 90, 20, 30]), {
            left: 20,
            top: 30,
            right: 80,
            bottom: 90,
            width: 60,
            height: 60,
        });
    });

    it("uses the target scale for regular rectangles", () => {
        assert.equal(getLimitedCaptureScale([10, 20, 410, 220]), PDF_RECT_CAPTURE_SCALE);
    });

    it("reduces the scale when an edge or the pixel count is too large", () => {
        const edgeLimited = getLimitedCaptureScale([0, 0, 16384, 100]);
        const pixelLimited = getLimitedCaptureScale([0, 0, 8000, 4000]);
        assert.ok(edgeLimited < 2);
        assert.ok(pixelLimited < PDF_RECT_CAPTURE_SCALE);
        assert.ok(pixelLimited > 2);
    });

    it("keeps rounded canvases within the configured limits", () => {
        const viewportRect = [0.4, 0.4, 8000.4, 4000.4];
        const captureScale = getLimitedCaptureScale(viewportRect);
        const ratio = captureScale / PDF_RECT_CAPTURE_SCALE;
        const bounds = getCaptureCanvasBounds([
            viewportRect[0] * ratio,
            viewportRect[1] * ratio,
            viewportRect[2] * ratio,
            viewportRect[3] * ratio,
        ]);
        assert.ok(bounds.width <= PDF_RECT_CAPTURE_MAX_EDGE);
        assert.ok(bounds.height <= PDF_RECT_CAPTURE_MAX_EDGE);
        assert.ok(bounds.width * bounds.height <= PDF_RECT_CAPTURE_MAX_PIXELS);
    });

    it("rejects empty and invalid rectangles", () => {
        assert.equal(getLimitedCaptureScale([10, 20, 10, 30]), 0);
        assert.equal(getLimitedCaptureScale([0, 0, Number.NaN, 30]), 0);
    });

    it("expands fractional bounds to complete canvas pixels", () => {
        assert.deepEqual(getCaptureCanvasBounds([20.8, 40.2, 10.1, 30.9]), {
            left: 10,
            top: 30,
            width: 11,
            height: 11,
        });
    });

    it("keeps a stable display width", () => {
        assert.equal(getCaptureDisplayWidth([10, 20, 130.126, 70]), 120.13);
        assert.equal(getCaptureDisplayWidth([10, 20, 10, 70]), 1);
    });
});
