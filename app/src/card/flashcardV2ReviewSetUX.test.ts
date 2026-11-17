import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const render = (summary?: {cards: number, due: number, included: number, excluded: number}) => {
    const snippet = source.slice(source.indexOf("const renderReviewSet ="),
        source.indexOf("const loadFlashcardV2ReviewSetSummaries ="));
    const script = transpileModule(`${snippet}\nrenderReviewSet(revision, summary);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    return runInNewContext(script, {
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        escapeAttr: (value: string) => value,
        escapeHtml: (value: string) => value.replace(/</g, "&lt;"),
        revision: {entityID: "set", revisionID: "revision", payload: {name: "<Set>", defaultReviewMode: "normal"}},
        summary,
    }) as string;
};

test("review-set counts have visible labels rather than ambiguous added/removed numbers", () => {
    const html = render({cards: 42, due: 7, included: 111, excluded: 222});
    assert.match(html, />riffCard 42<\/span>/);
    assert.match(html, />flashcardDueCard 7<\/span>/);
    assert.doesNotMatch(html, /111|222/);
    assert.doesNotMatch(render(), />riffCard \d/);
});

test("review-set actions remain visible and use native keyboard-activatable buttons", () => {
    const html = render();
    for (const action of ["cards", "review", "statistics", "edit", "delete"]) {
        assert.match(html, new RegExp(`<button type="button" data-type="${action}"`));
    }
    assert.doesNotMatch(html, /b3-list-item--hide-action/);
    assert.match(html, /&lt;Set>/);
    assert.match(source, /type === "cards" \|\|/);
    const css = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    assert.match(css, /\.card__v2-review-set\s*\{\s*flex-wrap: wrap;/);
    assert.match(css, /> button:focus-visible\s*\{\s*outline: 2px solid var\(--b3-theme-primary\)/);
});

test("summary refresh restores the focused action without stealing focus outside the row", () => {
    const snippet = source.slice(source.indexOf("const refreshReviewSet ="),
        source.indexOf("const refreshReviewSetSummary ="));
    const script = transpileModule(`${snippet}\nrefreshReviewSet(revision);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const inside of [true, false]) {
        let focused = "";
        let replaced = false;
        const oldItem = {
            dataset: {id: "set"}, contains: () => inside,
            set outerHTML(_value: string) { replaced = true; },
        };
        const newItem = {
            dataset: {id: "set"},
            querySelector: (selector: string) => ({focus: () => { focused = selector; }}),
        };
        runInNewContext(script, {
            document: {activeElement: {dataset: {type: "review"}}},
            dialog: {element: {querySelectorAll: () => [replaced ? newItem : oldItem]}},
            revision: {entityID: "set"}, summaries: {}, renderReviewSet: () => "row",
        });
        assert.ok(replaced);
        assert.equal(focused, inside ? '[data-type="review"]' : "");
    }
});

test("advanced source choices reuse keyboard-accessible picker controls", () => {
    const picker = source.slice(source.indexOf("const openFlashcardV2AdvancedSourcePicker ="),
        source.indexOf("export const openFlashcardV2AdvancedSource ="));
    assert.match(picker, /card__v2-review-picker/);
    assert.match(picker, /<li><button type="button" data-type="newAdvancedSource"/);
    assert.match(picker, /<li><button type="button" data-candidate-index=/);
    assert.doesNotMatch(picker, /<li data-(?:type|candidate-index)=/);
    assert.match(picker, /closest<HTMLElement>\("\[data-type='newAdvancedSource'\], \[data-candidate-index\]"\)/);
});
