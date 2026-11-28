import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {transpileModule, ScriptTarget} from "typescript";
import {escapeAttr, escapeHtml} from "../util/escape";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const start = source.indexOf("const renderFlashcardV2Preset =");
const end = source.indexOf("\n};", start) + 4;
assert.ok(start > 0 && end > start);
const compiled = transpileModule(source.slice(start, end), {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;
const render = (retention: number, mobile = false, newLimit = 5, reviewLimit = 10) => {
    const payload = {name: "QA <preset>", requestRetention: retention, maximumInterval: 36500, newLimit, reviewLimit};
    const original = JSON.stringify(payload);
    const html = runInNewContext(`${compiled}\nrenderFlashcardV2Preset(revision);`, {
        revision: {entityID: "preset", revisionID: "revision", payload}, escapeAttr, escapeHtml,
        isMobile: () => mobile, window: {siyuan: {languages: {
            flashcardNewCardLimit: "New <limit>", flashcardReviewCardLimit: "Review limit",
            flashcardTargetRetention: "Target retention", copy: "Copy", edit: "Edit", delete: "Delete",
        }}},
    }) as string;
    assert.equal(JSON.stringify(payload), original);
    return html;
};

test("preset summary renders independent escaped labels and values without changing configuration", () => {
    const html = render(0.9);
    assert.ok(html.includes(escapeHtml("QA <preset>")));
    assert.ok(html.includes(`<dt>${escapeHtml("New <limit>")}</dt><dd>5</dd>`));
    assert.doesNotMatch(html, /<preset>|<limit>/);
    assert.match(html, /<dt>Review limit<\/dt><dd>10<\/dd>/);
    assert.match(html, /<dt>Target retention<\/dt><dd>90%<\/dd>/);
    assert.doesNotMatch(html, /36500/);
    assert.equal((html.match(/<dt>/g) || []).length, 3);
});

test("preset summary preserves zero limits and formats percentages without floating point tails", () => {
    const html = render(0.29, true, 0, 0);
    assert.equal((html.match(/<dd>0<\/dd>/g) || []).length, 2);
    assert.match(html, /<dd>29%<\/dd>/);
    assert.match(render(0.875), /<dd>87.5%<\/dd>/);
    assert.match(render(1), /<dd>100%<\/dd>/);
});

test("preset summary retains row identity and copy edit delete actions on desktop and mobile", () => {
    for (const mobile of [false, true]) {
        const html = render(0.9, mobile);
        assert.match(html, /data-id="preset" data-revision="revision"/);
        for (const action of ["copy", "edit", "delete"]) {
            assert.ok(html.includes(`data-type="${action}"`));
        }
        assert.equal(html.includes("b3-list-item--hide-action"), !mobile);
    }
});

test("preset summary styles wrap locally without shrinking action controls", () => {
    const style = readFileSync("src/assets/scss/business/_card.scss", "utf8");
    const section = style.slice(style.indexOf("&__v2-preset {"), style.indexOf("&__v2-form,"));
    assert.match(section, /> \.b3-list-item__action\s*\{\s*flex-shrink: 0;/);
    assert.match(section, /&-content\s*\{[^}]*min-width: 0;[^}]*white-space: normal;[^}]*word-break: normal;/);
    assert.match(section, /&-summary\s*\{[^}]*flex-wrap: wrap;/);
});

test("the source chooser shows document inheritance without selecting a stale Alpha preset", () => {
    const start = source.indexOf("const openFlashcardV2SourcePreset =");
    const end = source.indexOf("const flashcardTagPath =", start);
    assert.ok(start > 0 && end > start);
    const script = transpileModule(source.slice(start, end) +
        '\nopenFlashcardV2SourcePreset("source", "live", presets, () => {});', {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const run = (presetOverrideID?: string) => {
        const options = {html: "", value: "", width: ""};
        const selector = {get value() { return options.value; }, set value(value: string) { options.value = value; }};
        let confirm: () => void;
        let mutation: {defaultPresetID?: string; presetOverrideID?: string};
        runInNewContext(script, {
            escapeAttr, escapeHtml, isMobile: () => true, genUUID: () => "operation",
            presets: [{id: "live", name: "Current <preset>"}, {id: "old", name: "Old"}, {id: "fixed", name: "Fixed"}],
            window: {siyuan: {languages: {flashcardFollowDocumentPreset: "Follow document default"}}},
            Dialog: class {
                element = {
                    querySelector: () => selector,
                    querySelectorAll: () => [{addEventListener: () => {}}, {
                        addEventListener: (_: string, callback: () => void) => { confirm = callback; },
                    }],
                };
                constructor({content, width}: {content: string; width: string}) {
                    options.html = content;
                    options.width = width;
                }
                destroy() {}
            },
            fetchPost: (url: string, request: {mutations?: {payload: typeof mutation}[]},
                done: (response?: unknown) => void) => {
                if (url.endsWith("getEntity")) {
                    done({data: {found: true, revision: {revisionID: "original",
                        payload: {sourceType: "qa", defaultPresetID: "old", presetOverrideID}}}});
                } else {
                    mutation = request.mutations[0].payload;
                    done();
                }
                return Promise.resolve();
            },
        });
        const selected = options.value;
        selector.value = "";
        confirm();
        return {...options, selected, mutation};
    };

    const inherited = run();
    assert.equal(inherited.width, "92vw");
    assert.ok(inherited.html.includes("Follow document default · " + escapeHtml("Current <preset>")));
    assert.equal(inherited.selected, "");
    const explicit = run("fixed");
    assert.equal(explicit.selected, "fixed");
    assert.equal(explicit.mutation.presetOverrideID, undefined);
    assert.equal(explicit.mutation.defaultPresetID, "old");
});
