import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {isLongUnbrokenInlineText} from "./inlineElementBoundary";

describe("long inline text wrapping", () => {
    it("distinguishes long runs from short identifiers and ordinary words", () => {
        assert.equal(isLongUnbrokenInlineText("x".repeat(31)), false);
        assert.equal(isLongUnbrokenInlineText("x".repeat(32)), true);
        assert.equal(isLongUnbrokenInlineText("1234567890".repeat(10)), true);
        assert.equal(isLongUnbrokenInlineText("ordinary words remain intact".repeat(3)), false);
        assert.equal(isLongUnbrokenInlineText("x".repeat(40) + " ordinary"), false);
        assert.equal(isLongUnbrokenInlineText(""), false);
    });

    it("ignores structural prefixes and preserves authored break controls", () => {
        assert.equal(isLongUnbrokenInlineText("\u200b\u2060\ufeff" + "x".repeat(32)), true);
        for (const separator of [" ", "\t", "\n", "\u200b", "\u2060", "\ufeff"]) {
            assert.equal(isLongUnbrokenInlineText("x".repeat(32) + separator + "y".repeat(32)), false);
        }
    });

    it("counts Unicode code points instead of UTF-16 code units", () => {
        assert.equal(isLongUnbrokenInlineText("\u{1f600}".repeat(16)), false);
        assert.equal(isLongUnbrokenInlineText("\u{1f600}".repeat(32)), true);
    });
});
