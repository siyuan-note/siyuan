import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const snippet = source.slice(source.indexOf("const typedFuzzyDistance ="), source.indexOf("let imageEditor:"));
const render = (config?: Record<string, unknown>, blockIDs = ["question", "answer"]) =>
    runInNewContext(transpileModule(`${snippet}\ntypedEditorHTML;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {edit: config ? {generationConfig: config} : undefined, blockIDs,
        window: {siyuan: {languages: {flashcardTypedFuzzyTip: "FUZZY_TIP"}}}}) as string;

test("typed editor explains its effective default and positive valid fuzzy thresholds", () => {
    for (const config of [undefined, {}, {fuzzyMaxRatio: .1}, {fuzzyMaxDistance: 1, fuzzyMaxRatio: 0},
        {fuzzyMaxDistance: 100, fuzzyMaxRatio: 0}, {fuzzyMaxRatio: 1},
        {caseSensitive: true, ignoreDiacritics: false, fuzzyMaxRatio: .1}]) {
        assert.match(render(config), /b3-label__text ft__on-surface">FUZZY_TIP/);
    }
});

test("strict or invalid thresholds never claim fuzzy matching is enabled", () => {
    for (const config of [{fuzzyMaxDistance: 0, fuzzyMaxRatio: 0}, {fuzzyMaxRatio: 0},
        {fuzzyMaxDistance: .5, fuzzyMaxRatio: 0}, {fuzzyMaxDistance: -1, fuzzyMaxRatio: 0},
        {fuzzyMaxDistance: Infinity, fuzzyMaxRatio: 0}, {fuzzyMaxRatio: -1},
        {fuzzyMaxRatio: 1.1}, {fuzzyMaxRatio: NaN}]) {
        assert.doesNotMatch(render(config), /FUZZY_TIP/);
    }
    assert.equal(render(undefined, ["question"]), "");
});

test("the note stays within the typed-only editor and does not introduce threshold controls", () => {
    const html = render();
    assert.match(html, /^<div data-type="typedEditor" class="fn__none/);
    assert.match(html, /data-type="typedCaseSensitive"/);
    assert.match(html, /data-type="typedMatchDiacritics"/);
    assert.doesNotMatch(html, /type="number"/);
    assert.match(source, /fuzzyMaxRatio: edit\?\.generationConfig\.fuzzyMaxRatio \?\? 0\.1/);
});
