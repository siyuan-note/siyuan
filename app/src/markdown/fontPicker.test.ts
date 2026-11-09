import * as assert from "node:assert/strict";
import {test} from "node:test";
import {filterMarkdownFonts, markdownFontVariants, reorderMarkdownFonts} from "./fontPicker";

const fonts = [
    {family: "Sans", displayName: "Sans Bold", weight: 700, aliases: ["Alternate"]},
    {family: "Sans", displayName: "Sans Regular", weight: 400},
    {family: "Mono", displayName: "Mono", weight: 400, spacing: "monospace"},
    {family: "Dual", displayName: "Dual", weight: 500, spacing: "dual"},
];

test("Markdown font search combines aliases, deduplicates families and prefers regular preview", () => {
    const result = filterMarkdownFonts(fonts, " alternate ", false, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].family, "Sans");
    assert.equal(result[0].weight, 400);
    assert.equal(filterMarkdownFonts(fonts, "missing", false, []).length, 0);
});

test("Markdown monospace filtering includes dual width and preserves selected proportional fonts", () => {
    assert.deepEqual(filterMarkdownFonts(fonts, "", true, []).map(font => font.family), ["Dual", "Mono"]);
    assert.equal(filterMarkdownFonts(fonts, "", true, [{family: "Sans", weight: 700}]).length, 3);
    assert.equal(filterMarkdownFonts(fonts, "", false, []).length, 3);
});

test("Markdown weights come only from actual family variants and chip ordering is bounded", () => {
    assert.deepEqual(markdownFontVariants(fonts, "Sans").map(font => font.weight), [400, 700]);
    assert.deepEqual(markdownFontVariants(fonts, "Missing"), []);
    const selection = [{family: "Sans", weight: 700}, {family: "Mono", weight: 400}];
    assert.deepEqual(reorderMarkdownFonts(selection, 0, 1).map(font => font.family), ["Mono", "Sans"]);
    assert.deepEqual(selection.map(font => font.family), ["Sans", "Mono"]);
    assert.equal(reorderMarkdownFonts(selection, -1, 0), selection);
    assert.equal(reorderMarkdownFonts(selection, 0, 2), selection);
});
