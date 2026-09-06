import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    AVCellOverflowMetrics,
    hasAVCellContentOverflow,
    shouldMeasureAVCellContentOverflow,
} from "./cellOverflow";

const metrics = (clientWidth: number, scrollWidth: number,
                 clientHeight = 24, scrollHeight = clientHeight): AVCellOverflowMetrics => ({
    clientHeight,
    clientWidth,
    scrollHeight,
    scrollWidth,
});

describe("attribute view cell overflow", () => {
    it("detects regular horizontal overflow", () => {
        assert.equal(hasAVCellContentOverflow(metrics(100, 103)), true);
        assert.equal(hasAVCellContentOverflow(metrics(100, 102)), false);
    });

    it("detects overflow clipped inside a rich-text preview", () => {
        const cell = metrics(100, 100);

        assert.equal(hasAVCellContentOverflow(cell, metrics(100, 101)), true);
        assert.equal(hasAVCellContentOverflow(cell, metrics(100, 100, 24, 25)), true);
        assert.equal(hasAVCellContentOverflow(cell, metrics(100, 100, 24, 24)), false);
    });

    it("measures wrapped cells only when their rich-text preview remains clipped", () => {
        assert.equal(shouldMeasureAVCellContentOverflow("true", false), false);
        assert.equal(shouldMeasureAVCellContentOverflow("true", true), true);
        assert.equal(shouldMeasureAVCellContentOverflow("false", false), true);
    });
});
