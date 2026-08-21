import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";
import type {IInlineStyle} from "./inlineStyle";

let inlineStyle: typeof import("./inlineStyle");

before(async () => {
    Object.assign(globalThis, {
        NODE_ENV: "test",
        SIYUAN_VERSION: "test",
    });
    inlineStyle = await import("./inlineStyle");
});

const combinedStyle: IInlineStyle = {
    id: "20260821120000-abcdefg",
    name: "Combined",
    light: {
        color: "#112233",
        backgroundColor: "#ddeeff",
    },
    dark: {
        color: "#fefefe",
        backgroundColor: "#223344",
    },
};

describe("normalizeInlineStyles", () => {
    it("keeps paired light and dark colors and removes invalid data", () => {
        assert.deepEqual(inlineStyle.normalizeInlineStyles({
            version: 9,
            styles: [combinedStyle, {
                id: combinedStyle.id,
                name: "Duplicate",
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }, {
                id: "20260821120001-bbcdefg",
                name: " Background ",
                light: {color: "invalid", backgroundColor: "#AABBCC"},
                dark: {backgroundColor: "#001122"},
            }, {
                id: "invalid-id",
                name: "Invalid",
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }],
        }), {
            version: 1,
            styles: [combinedStyle, {
                id: "20260821120001-bbcdefg",
                name: "Background",
                light: {backgroundColor: "#aabbcc"},
                dark: {backgroundColor: "#001122"},
            }],
        });
    });

    it("limits names by Unicode code points without splitting surrogate pairs", () => {
        const normalized = inlineStyle.normalizeInlineStyles({
            version: 1,
            styles: [{
                id: "20260821120002-cbcdefg",
                name: "😀".repeat(65),
                light: {color: "#ffffff"},
                dark: {color: "#000000"},
            }],
        });
        assert.equal([...normalized.styles[0].name].length, 64);
        assert.equal(normalized.styles[0].name.endsWith("😀"), true);
    });
});

describe("inline style values", () => {
    it("infers the legacy appearance type from available properties", () => {
        assert.equal(inlineStyle.getInlineStyleType(combinedStyle), "style1");
        assert.equal(inlineStyle.getInlineStyleType({...combinedStyle, light: {color: "#112233"}, dark: {color: "#ffffff"}}), "color");
        assert.equal(inlineStyle.getInlineStyleType({
            ...combinedStyle,
            light: {backgroundColor: "#ddeeff"},
            dark: {backgroundColor: "#223344"},
        }), "backgroundColor");
    });

    it("encodes combined styles as background then foreground", () => {
        const encoded = inlineStyle.encodeStyle1("#ddeeff", "#112233");
        assert.equal(encoded, "#ddeeff\u200b#112233");
        assert.deepEqual(inlineStyle.decodeStyle1(encoded), {
            backgroundColor: "#ddeeff",
            color: "#112233",
        });
    });

    it("builds variable references with current-mode fallbacks", () => {
        assert.deepEqual(inlineStyle.getInlineStyleApplication(combinedStyle, "dark"), {
            type: "style1",
            color: "var(--b3-inline-style-20260821120000-abcdefg-background-color, #223344)" +
                "\u200b" +
                "var(--b3-inline-style-20260821120000-abcdefg-color, #fefefe)",
        });
    });
});

describe("getInlineStylesCSS", () => {
    it("generates isolated light and dark variables", () => {
        assert.equal(inlineStyle.getInlineStylesCSS({version: 1, styles: [combinedStyle]}), `:root[data-theme-mode="light"] {
  --b3-inline-style-20260821120000-abcdefg-color: #112233;
  --b3-inline-style-20260821120000-abcdefg-background-color: #ddeeff;
}
:root[data-theme-mode="dark"] {
  --b3-inline-style-20260821120000-abcdefg-color: #fefefe;
  --b3-inline-style-20260821120000-abcdefg-background-color: #223344;
}`);
    });
});

describe("recent inline styles", () => {
    it("extracts a stable preset ID and ignores changing fallbacks", () => {
        const first = "color\u200b" +
            "var(--b3-inline-style-20260821120000-abcdefg-color, #112233)";
        const second = "color\u200b" +
            "var(--b3-inline-style-20260821120000-abcdefg-color, #445566)";
        assert.equal(inlineStyle.getInlineStyleIDFromValue(first), combinedStyle.id);
        assert.equal(inlineStyle.getRecentInlineStyleKey(first), inlineStyle.getRecentInlineStyleKey(second));
    });
});
