import * as assert from "node:assert/strict";
import {test} from "node:test";
import {isMixedFontSize, normalizeFontSizeInput} from "./fontSizeCore";

test("font size input preserves pixel and relative units within supported bounds", () => {
    assert.equal(normalizeFontSizeInput("9", false), "9px");
    assert.equal(normalizeFontSizeInput("72", false), "72px");
    assert.equal(normalizeFontSizeInput("56", true), "0.56em");
    assert.equal(normalizeFontSizeInput("450", true), "4.5em");
    assert.equal(normalizeFontSizeInput("125", true), "1.25em");
    assert.equal(normalizeFontSizeInput(" 16 ", false), "16px");
});

test("font size input rejects blank, non-finite and out-of-range values", () => {
    for (const value of ["", " ", "NaN", "Infinity", "-1", "0", "16px"]) {
        assert.equal(normalizeFontSizeInput(value, false), undefined);
        assert.equal(normalizeFontSizeInput(value, true), undefined);
    }
    assert.equal(normalizeFontSizeInput("8", false), undefined);
    assert.equal(normalizeFontSizeInput("73", false), undefined);
    assert.equal(normalizeFontSizeInput("55", true), undefined);
    assert.equal(normalizeFontSizeInput("451", true), undefined);
});

test("font size selection distinguishes uniform, mixed and empty selections", () => {
    assert.equal(isMixedFontSize([]), false);
    assert.equal(isMixedFontSize(["16px", "16px"]), false);
    assert.equal(isMixedFontSize(["16px", "24px"]), true);
});
