import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const escapeAttr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

test("the leading flag is a named native menu button visible on mouse and touch layouts", () => {
    const line = source.split("\n").find(item => item.includes('data-type="flag" data-menu="true"'));
    const html = runInNewContext("`" + line + "`", {
        result: {card: {flag: 2}}, flagDefinitions: [], escapeAttr,
        flashcardFlagLabel: () => 'Study "later"', flashcardFlagStyle: () => "",
        window: {siyuan: {languages: {flashcardFlag: "Flag"}}},
    });
    assert.match(html, /^<button type="button" data-type="flag"/);
    assert.match(html, /aria-haspopup="menu"/);
    assert.match(html, /aria-label="Flag - Study &quot;later&quot;"/);
    assert.match(html, /block__icon--show block__icon--touch/);
    assert.match(html, /<\/button>/);
    const leading = source.slice(source.indexOf('<span class="card__v2-managed-leading">'), source.indexOf('<span class="card__v2-managed-main">'));
    assert.ok(leading.includes(line));
    assert.doesNotMatch(leading, /iconRiffCard/);
    const css = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    assert.match(css, /\.card__v2-managed-leading > button:focus-visible,/);
    assert.match(css, /\.card__v2-managed-card > button:focus-visible\s*\{\s*outline: 2px solid var\(--b3-theme-primary\)/);
});

test("tag checkboxes announce escaped complete paths while retaining mixed and checked states", () => {
    const script = source.slice(source.indexOf("const flashcardTagPath ="),
        source.indexOf("const flashcardTagDescendants ="));
    for (const mobile of [false, true]) {
        const html = runInNewContext(transpileModule(`${script}\nrenderFlashcardTagChoices(tags, selected, mixed);`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, {
            tags: [{id: "parent", name: 'Root "a"'}, {id: "child", name: "Same", parentID: "parent"},
                {id: "other", name: "Same"}],
            selected: new Set(["other"]), mixed: new Set(["child"]),
            escapeAttr, escapeHtml: escapeAttr, isMobile: () => mobile,
            window: {siyuan: {languages: {edit: "Edit"}}},
        });
        assert.match(html, /value="child" aria-label="Root &quot;a&quot; \/ Same" aria-checked="mixed"/);
        assert.match(html, /value="other" aria-label="Same" aria-checked="true" checked/);
        assert.doesNotMatch(html, /tabindex="-1"/);
    }
});
