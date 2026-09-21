import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {getLongTextRanges} from "./longTextWrap";

describe("long text runs", () => {
    it("finds long runs after Chinese and spaces without including ordinary words", () => {
        const text = "测试" + "1".repeat(94) + " ordinary words " + "a".repeat(63) + " end";
        assert.deepEqual(getLongTextRanges(text).map(range => text.substring(range.start, range.end)),
            ["1".repeat(94), "a".repeat(63)]);
        assert.deepEqual(getLongTextRanges("test " + "3".repeat(32)), [{start: 5, end: 37}]);
    });

    it("counts each run independently at the threshold", () => {
        assert.deepEqual(getLongTextRanges("a".repeat(31) + " " + "b".repeat(31)), []);
        assert.deepEqual(getLongTextRanges("a".repeat(32)), [{start: 0, end: 32}]);
        assert.deepEqual(getLongTextRanges("ordinary words remain intact".repeat(4)), []);
        assert.deepEqual(getLongTextRanges("测试".repeat(32)), []);
    });

    it("preserves explicit joiners and locates runs after semantic prefixes", () => {
        assert.deepEqual(getLongTextRanges("\u2060" + "x".repeat(32)), [{start: 1, end: 33}]);
        assert.deepEqual(getLongTextRanges("x".repeat(32) + "\u2060" + "y".repeat(32)), []);
        assert.deepEqual(getLongTextRanges("x".repeat(32) + "\ufeff" + "y".repeat(32)), []);
    });
});
