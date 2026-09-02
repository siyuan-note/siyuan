import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
    getInlineFontFamilyName,
    getInlineFontFamilySelection,
    getInlineFontFamilyStyle,
    hasInlineFontFamilyExcludedType,
} from "./fontFamilyCore";

describe("inline font family", () => {
    it("round-trips font names and preserves the editor fallback stack", () => {
        const family = "A \"quoted\" 'single' \\ family 字体";
        const value = getInlineFontFamilyStyle(family);
        assert.match(value, /^var\(--b3-font-family-emoji-reset\),/);
        assert.doesNotMatch(value, /"/);
        assert.match(value, /var\(--b3-font-family-editor\), var\(--b3-font-family\)$/);
        assert.equal(getInlineFontFamilyName(value), family);
        const defaultValue = getInlineFontFamilyStyle();
        assert.equal(defaultValue,
            "var(--b3-font-family-emoji-reset), var(--b3-font-family-editor), var(--b3-font-family)");
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

    it("defines the emoji reset stack for every frontend bundle and built-in theme", () => {
        const declaration = '--b3-font-family-emoji-reset: "Emojis Additional", "Emojis Reset";';
        [
            "src/assets/scss/component/_typography.scss",
            "appearance/themes/daylight/theme.css",
            "appearance/themes/midnight/theme.css",
        ].forEach(path => {
            assert.ok(readFileSync(resolve(process.cwd(), path), "utf8").includes(declaration), path);
        });
    });
});
