import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {flashcardV2ConflictSummary, FlashcardV2ConflictProgress} from "./flashcardV2ConflictSummary";

test("conflict summaries show named settings without guessing unknown payload shapes", () => {
    assert.deepEqual(flashcardV2ConflictSummary({name: "<Deck>", newLimit: 0, reviewLimit: 20, unknown: "hidden"},
        {name: "Name", flashcardNewCardLimit: "New", flashcardReviewCardLimit: "Review"}), [
        {label: "Name", value: '"<Deck>"', different: false}, {label: "New", value: "0", different: false},
        {label: "Review", value: "20", different: false},
    ]);
    const invalid: unknown[] = [null, [], "text", {name: {nested: "not a name"}}];
    for (const payload of invalid) {
        assert.deepEqual(flashcardV2ConflictSummary(payload, {name: "Name"}), []);
    }
});

test("each version shows the same known fields and distinguishes missing, empty and zero", () => {
    const versions = [{name: "", newLimit: 0}, {name: "Deck"}, {name: "Deck", newLimit: null}];
    const language = {name: "Name", flashcardNewCardLimit: "New", flashcardConflictMissingValue: "Absent"};
    const summaries = versions.map(value => flashcardV2ConflictSummary(value, language, versions));
    assert.deepEqual(summaries.map(fields => fields.map(field => field.label)), [
        ["Name", "New"], ["Name", "New"], ["Name", "New"],
    ]);
    assert.equal(summaries[0][0].value, '""');
    assert.equal(summaries[0][1].value, "0");
    assert.equal(summaries[1][1].value, "Absent");
    assert.equal(summaries[2][1].value, "null");
    assert.ok(summaries.every(fields => fields.every(field => field.different)));
});

test("comparison uses raw values and does not infer equality of unknown fields", () => {
    const versions = [{newLimit: 0, custom: "first"}, {newLimit: "0", custom: "second"}];
    assert.ok(flashcardV2ConflictSummary(versions[0], {flashcardNewCardLimit: "New"}, versions)[0].different);
    assert.equal(flashcardV2ConflictSummary(versions[0], {flashcardNewCardLimit: "New"}, versions)[0].value, "0");
    assert.equal(flashcardV2ConflictSummary(versions[1], {flashcardNewCardLimit: "New"}, versions)[0].value, '"0"');
    const nulls = [{name: null}, {name: "null"}];
    assert.deepEqual(nulls.map(payload => flashcardV2ConflictSummary(payload, {name: "Name"}, nulls)[0].value),
        ["null", '"null"']);
    assert.deepEqual(flashcardV2ConflictSummary({custom: "first"}, {}, [{custom: "first"}, {custom: "second"}]), []);
});

test("partial conflict resolution resumes only unresolved groups after a failed request", async () => {
    const progress = new FlashcardV2ConflictProgress();
    const calls: number[] = [];
    assert.equal(await progress.resolve(3, async index => {
        calls.push(index);
        return index !== 1;
    }), false);
    assert.ok(progress.has(0));
    assert.equal(progress.has(1), false);
    assert.equal(await progress.resolve(3, async index => { calls.push(index); return true; }), true);
    assert.deepEqual(calls, [0, 1, 1, 2]);
});

test("a thrown request preserves completed conflict groups for retry", async () => {
    const progress = new FlashcardV2ConflictProgress();
    await assert.rejects(progress.resolve(2, async index => {
        if (index === 1) { throw new Error("offline"); }
        return true;
    }), /offline/);
    assert.ok(progress.has(0));
    assert.equal(await progress.resolve(2, async index => { assert.equal(index, 1); return true; }), true);
});

test("conflict UI keeps full escaped JSON, marks deleted revisions and uses retry-safe form submission", () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8");
    const conflict = source.slice(source.indexOf("const openFlashcardV2Conflicts ="),
        source.indexOf("interface IFlashcardManagementDialog"));
    assert.match(conflict, /<details class="card__v2-disclosure"><summary>\$\{flashcardV2DisclosureIcon\}<span>JSON<\/span><\/summary>/);
    assert.match(conflict, /escapeHtml\(payload \|\| "null"\)/);
    assert.doesNotMatch(conflict, /slice\(0, 4000\)/);
    assert.match(conflict, /revision.deleted \?/);
    assert.match(conflict, /field.different \? `<mark>\$\{escapeHtml\(field.value\)\}/);
    assert.match(conflict, /submitFlashcardV2Form\(dialog.element/);
    assert.match(conflict, /operations\[index\]\(payload\)/);
    assert.match(conflict, /beforeClose: .*aria-busy/);
    assert.match(conflict, /undefined, undefined, undefined, 30000/);
});
