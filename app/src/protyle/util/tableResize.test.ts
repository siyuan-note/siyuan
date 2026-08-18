import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
    constrainTableResizeCount,
    getTableResizeControlCenter,
    getTableResizeCount,
    isTableResizeControlVisible,
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

describe("getTableResizeControlCenter", () => {
    it("keeps the control after a visible table edge", () => {
        assert.equal(getTableResizeControlCenter(240, 0, 400, 16), 248);
        assert.equal(getTableResizeControlCenter(240, 0, 400, 16, 10), 258);
    });

    it("keeps the whole control inside the editor viewport", () => {
        assert.equal(getTableResizeControlCenter(395, 0, 400, 16), 392);
        assert.equal(getTableResizeControlCenter(450, 0, 400, 16), 392);
    });
});

describe("isTableResizeControlVisible", () => {
    it("requires enough viewport space for the whole control", () => {
        assert.equal(isTableResizeControlVisible(384, 400, 16), true);
        assert.equal(isTableResizeControlVisible(374, 400, 16, 10), true);
        assert.equal(isTableResizeControlVisible(384, 400, 16, 10), false);
        assert.equal(isTableResizeControlVisible(395, 400, 16), false);
        assert.equal(isTableResizeControlVisible(450, 400, 16), false);
    });
});
