import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getInlineFontFamilyName,
    getInlineFontFamilySelection,
    getInlineFontFamilyStyle,
    hasInlineFontFamilyExcludedType,
} from "./fontFamilyCore";

describe("inline font family", () => {
    it("round-trips font names and preserves the editor fallback stack", () => {
        const family = 'A "quoted" \\ family 字体';
        const value = getInlineFontFamilyStyle(family);
        assert.match(value, /^"Emojis Additional", "Emojis Reset",/);
        assert.match(value, /var\(--b3-font-family-editor\), var\(--b3-font-family\)$/);
        assert.equal(getInlineFontFamilyName(value), family);
        const defaultValue = getInlineFontFamilyStyle();
        assert.equal(defaultValue,
            '"Emojis Additional", "Emojis Reset", var(--b3-font-family-editor), var(--b3-font-family)');
        assert.equal(getInlineFontFamilyName(defaultValue), undefined);
        assert.equal(getInlineFontFamilyName('"Emojis Additional", "Emojis Reset", "Font, Name", serif'),
            "Font, Name");
        assert.equal(getInlineFontFamilyName('"Plain Font", serif'), "Plain Font");
        assert.equal(getInlineFontFamilyName("unset"), undefined);
        assert.equal(getInlineFontFamilyName('"\\ffffff "'), "�");
    });

    it("distinguishes default, uniform and mixed selections", () => {
        assert.deepEqual(getInlineFontFamilySelection([undefined, undefined], true), {
            disabled: false,
            family: undefined,
            mixed: false,
        });
        assert.deepEqual(getInlineFontFamilySelection([
            getInlineFontFamilyStyle("Arial"),
            getInlineFontFamilyStyle("Arial"),
        ], true), {
            disabled: false,
            family: "Arial",
            mixed: false,
        });
        assert.deepEqual(getInlineFontFamilySelection([
            getInlineFontFamilyStyle("Arial"),
            getInlineFontFamilyStyle("Georgia"),
        ], true), {
            disabled: false,
            family: undefined,
            mixed: true,
        });
    });

    it("disables selections without eligible text and recognizes protected inline types", () => {
        assert.deepEqual(getInlineFontFamilySelection([], false), {
            disabled: true,
            family: undefined,
            mixed: false,
        });
        assert.equal(hasInlineFontFamilyExcludedType(["strong", "code", "text"]), true);
        assert.equal(hasInlineFontFamilyExcludedType(["strong", "a", "text"]), false);
    });
});
