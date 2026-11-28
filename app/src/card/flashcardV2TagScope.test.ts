import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const start = source.indexOf("const editableReviewSetPredicates:");
const end = source.indexOf("const openFlashcardV2ReviewSetEditor", start);
const script = source.slice(source.indexOf("const flashcardTagFilter ="), source.indexOf("const flashcardTagFilterFields =")) +
    source.slice(start, end);
const context: Record<string, any> = {FLASHCARD_LEECH_TAG_ID: "leech"};
runInNewContext(transpileModule(`${script}\nthis.api = {reviewSetTagValues, reviewSetQuery, flashcardManagementQuery, flashcardManagementFilterCount};`, {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText, context);
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

test("tag scope is identical in management and saved review sets", () => {
    for (const tagScope of ["", "descendantOf"]) {
        for (const tagMatch of ["any", "all"]) {
            const filters = {tagIDs: ["parent", "other"], tagScope, tagMatch};
            const saved = context.api.reviewSetQuery({}, undefined, filters);
            const management = context.api.flashcardManagementQuery(filters);
            assert.deepEqual(plain(saved), plain(management));
            assert.equal(saved.root.operator, tagMatch === "all" ? "and" : "or");
            assert.ok(saved.root.children.every((child: {comparator: string}) => child.comparator === (tagScope || "equal")));
            assert.deepEqual(plain(context.api.reviewSetTagValues(saved)), filters);
            const edited = context.api.reviewSetQuery({priority: "exam"}, saved);
            assert.deepEqual(plain(edited.root.children[0]), plain(saved.root));
        }
    }
});

test("editing a descendant filter replaces rather than compounds it", () => {
    const base = {version: 1, root: {operator: "and", children: [
        {operator: "predicate", field: "tagID", comparator: "descendantOf", value: "old"},
        {operator: "predicate", field: "flag", comparator: "equal", value: 2},
    ]}};
    const updated = context.api.reviewSetQuery({}, base, {tagIDs: ["new"], tagScope: ""});
    assert.equal(updated.root.children.length, 2);
    assert.equal(updated.root.children[0].field, "flag");
    assert.equal(updated.root.children[1].comparator, "equal");
    assert.equal(updated.root.children[1].value, "new");
    assert.equal(context.api.reviewSetQuery({tagScope: "descendantOf"}).root.operator, "matchAll");
    assert.equal(context.api.flashcardManagementQuery({tagScope: "descendantOf"}), undefined);
    assert.equal(context.api.flashcardManagementFilterCount({tagScope: "descendantOf"}), 0);
    assert.equal(context.api.flashcardManagementFilterCount({tagIDs: ["parent", "sibling"], tagScope: "descendantOf"}), 1);
});

test("preset inheritance is the source default, never the card override", () => {
    const from = source.indexOf("        const inheritedPreset =");
    const to = source.indexOf("        const dialog =", from);
    const state = {presets: [{id: "source", name: "Source preset"}, {id: "override", name: "Card preset"}],
        card: {defaultPresetID: "source", effectivePresetID: "override", card: {presetOverrideID: "override"}},
        type: "preset", window: {siyuan: {languages: {flashcardInheritedPreset: "Inherit: ${name}", default: "Default"}}},
        label: ""};
    runInNewContext(`${source.slice(from, to)}this.label = defaultLabel;`, state);
    assert.equal(state.label, "Inherit: Source preset");
});
