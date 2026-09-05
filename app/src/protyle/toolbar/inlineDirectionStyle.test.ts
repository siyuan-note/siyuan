import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    hasInlineDirectionStyle,
    hasSameInlineDirectionStyle,
    normalizeInlineDirection,
    setInlineDirectionStyle,
} from "./inlineDirectionStyle";

const createStyle = (direction = "", unicodeBidi = "") => ({
    direction,
    unicodeBidi,
    removeProperty(property: string) {
        if (property === "direction") {
            this.direction = "";
        } else if (property === "unicode-bidi") {
            this.unicodeBidi = "";
        }
        return "";
    },
}) as CSSStyleDeclaration;

describe("inline direction style", () => {
    it("normalizes only supported directions", () => {
        assert.equal(normalizeInlineDirection("ltr"), "ltr");
        assert.equal(normalizeInlineDirection("rtl"), "rtl");
        assert.equal(normalizeInlineDirection("auto"), undefined);
        assert.equal(normalizeInlineDirection(""), undefined);
    });

    it("sets an isolated explicit direction", () => {
        const style = createStyle();
        setInlineDirectionStyle(style, "rtl");
        assert.equal(style.direction, "rtl");
        assert.equal(style.unicodeBidi, "isolate");
        assert.equal(hasInlineDirectionStyle(style, "rtl"), true);
        assert.equal(hasInlineDirectionStyle(style, "ltr"), false);
    });

    it("clears both direction properties", () => {
        const style = createStyle("ltr", "isolate");
        setInlineDirectionStyle(style, "");
        assert.equal(hasInlineDirectionStyle(style), true);
    });

    it("keeps differently directed spans separate", () => {
        assert.equal(hasSameInlineDirectionStyle(
            createStyle("ltr", "isolate"), createStyle("rtl", "isolate")), false);
        assert.equal(hasSameInlineDirectionStyle(
            createStyle("rtl", "isolate"), createStyle("rtl", "isolate")), true);
    });
});
