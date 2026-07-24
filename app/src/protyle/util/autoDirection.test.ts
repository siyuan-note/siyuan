import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {classifyTextDirection} from "./autoDirection";

describe("classifyTextDirection", () => {
    it("detects common RTL scripts", () => {
        assert.equal(classifyTextDirection("سلام دنیا"), "rtl");
        assert.equal(classifyTextDirection("مرحبا بالعالم"), "rtl");
        assert.equal(classifyTextDirection("שלום עולם"), "rtl");
    });

    it("detects LTR Unicode letters beyond ASCII", () => {
        assert.equal(classifyTextDirection("Hello world"), "ltr");
        assert.equal(classifyTextDirection("Привет мир"), "ltr");
        assert.equal(classifyTextDirection("Γειά σου κόσμε"), "ltr");
        assert.equal(classifyTextDirection("你好世界"), "ltr");
    });

    it("keeps numbers, punctuation, whitespace, and symbols neutral", () => {
        assert.equal(classifyTextDirection("12345 - 67890 !!!"), "neutral");
        assert.equal(classifyTextDirection("۱۲۳۴۵، ۶۷۸۹۰ !!!"), "neutral");
        assert.equal(classifyTextDirection("١٢٣٤٥، ٦٧٨٩٠ !!!"), "neutral");
        assert.equal(classifyTextDirection("$100 + €20"), "neutral");
    });

    it("requires at least two RTL letters", () => {
        assert.equal(classifyTextDirection("س"), "neutral");
        assert.equal(classifyTextDirection("א"), "neutral");
        assert.equal(classifyTextDirection("A س"), "ltr");
    });

    it("uses the balanced RTL ratio for mixed content", () => {
        assert.equal(classifyTextDirection("GPT-5 برای نوشتن این متن فارسی استفاده شده است"), "rtl");
        assert.equal(classifyTextDirection("API تست فارسی"), "rtl");
        assert.equal(classifyTextDirection("This is a mostly English sentence with متن"), "ltr");
    });

    it("does not let leading numbers decide the direction", () => {
        assert.equal(classifyTextDirection("2026 سلام دنیا"), "rtl");
        assert.equal(classifyTextDirection("۲۰۲۶ سلام دنیا"), "rtl");
        assert.equal(classifyTextDirection("2026 Hello world"), "ltr");
    });
});
