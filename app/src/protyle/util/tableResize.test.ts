import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    constrainTableResizeCount,
    getTableResizeCount,
    isTableCellContentEmpty,
} from "./tableResize";

describe("isTableCellContentEmpty", () => {
    it("ignores editor placeholders and whitespace", () => {
        assert.equal(isTableCellContentEmpty(" \n\u200B\u200D\uFEFF", false), true);
    });

    it("keeps text and non-text content", () => {
        assert.equal(isTableCellContentEmpty("content", false), false);
        assert.equal(isTableCellContentEmpty("", true), false);
    });
});

describe("getTableResizeCount", () => {
    it("uses the appended item size while growing", () => {
        assert.equal(getTableResizeCount(3, 29, 60, [80, 80, 80]), 3);
        assert.equal(getTableResizeCount(3, 31, 60, [80, 80, 80]), 4);
        assert.equal(getTableResizeCount(3, 91, 60, [80, 80, 80]), 5);
    });

    it("follows existing item boundaries while shrinking", () => {
        assert.equal(getTableResizeCount(4, -19, 60, [40, 50, 60, 40]), 4);
        assert.equal(getTableResizeCount(4, -21, 60, [40, 50, 60, 40]), 3);
        assert.equal(getTableResizeCount(4, -71, 60, [40, 50, 60, 40]), 2);
    });
});

describe("constrainTableResizeCount", () => {
    it("does not shrink past non-empty content", () => {
        assert.equal(constrainTableResizeCount(1, 5, 3, new Set()), 3);
    });

    it("does not split merged cells", () => {
        assert.equal(constrainTableResizeCount(3, 6, 1, new Set([2, 3])), 4);
        assert.equal(constrainTableResizeCount(1, 6, 1, new Set([2, 3])), 1);
    });

    it("does not constrain growth", () => {
        assert.equal(constrainTableResizeCount(8, 5, 4, new Set([4])), 8);
    });
});
