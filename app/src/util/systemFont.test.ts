import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getFontFamilyDisplayName, getUniqueFontFamilies} from "./systemFontCore";

describe("getFontFamilyDisplayName", () => {
    const fonts = [{
        family: "eryapang",
        weight: 400,
        displayName: "尔雅胖丁体",
    }, {
        family: "Fallback Font",
        weight: 400,
        displayName: "",
    }];

    it("uses the display name and falls back to the CSS family", () => {
        assert.equal(getFontFamilyDisplayName(fonts, "eryapang"), "尔雅胖丁体");
        assert.equal(getFontFamilyDisplayName(fonts, "Fallback Font"), "Fallback Font");
        assert.equal(getFontFamilyDisplayName(fonts, "Unknown Font"), "Unknown Font");
        assert.equal(getFontFamilyDisplayName(fonts), undefined);
    });
});

describe("getUniqueFontFamilies", () => {
    it("keeps one regular entry per family and merges searchable aliases", () => {
        assert.deepEqual(getUniqueFontFamilies([{
            family: "Example Sans",
            weight: 700,
            displayName: "Example Sans Bold",
            aliases: ["示例粗体"],
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例"],
        }, {
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }]), [{
            family: "Another Font",
            weight: 400,
            displayName: "Another Font",
        }, {
            family: "Example Sans",
            weight: 400,
            displayName: "Example Sans",
            aliases: ["示例粗体", "示例"],
        }]);
    });
});
