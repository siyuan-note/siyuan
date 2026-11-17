import * as assert from "node:assert/strict";
import {test} from "node:test";
import {resolveOrderedSummaries} from "./flashcardV2OrderedSummary";
const steps = [{id: "first", displayOrder: 2, occlusionIDs: ["a"]}, {id: "second", displayOrder: 1, occlusionIDs: ["b"]}];
const refs = [{entityType: "block", entityID: "one", role: "content"}];
const blocks = () => new Map([["one", {text: "Alpha Beta", marks: new Map([["a", "Alpha"], ["b", "Beta"]])}]]);
test("readable inline summaries preserve stable IDs in display order", () => {
    assert.deepEqual(resolveOrderedSummaries(steps, [...refs, ...refs], blocks()), [{id: "second", text: "Beta"}, {id: "first", text: "Alpha"}]);
    assert.equal(steps[0].id, "first");
});
test("unknown, blank, duplicate and cross-block marks cannot become guessed numbered summaries", () => {
    const source = blocks(); source.set("two", source.get("one"));
    assert.equal(resolveOrderedSummaries(steps, [...refs, {...refs[0], entityID: "two"}], source), undefined);
    source.get("one").marks.set("a", " ");
    assert.equal(resolveOrderedSummaries(steps, refs, source), undefined);
    assert.equal(resolveOrderedSummaries([...steps, steps[0]], refs, blocks()), undefined);
    assert.equal(resolveOrderedSummaries(steps, [{...refs[0], entityID: "missing"}], blocks()), undefined);
});
test("block mapping must be unique and cannot silently override an inline mapping", () => {
    const source = new Map([["one", {text: "Readable block", marks: new Map<string, string>()}]]);
    const reference = {...refs[0], role: "occlusion:a"};
    assert.deepEqual(resolveOrderedSummaries([steps[0]], [reference, reference], source), [{id: "first", text: "Readable block"}]);
    assert.equal(resolveOrderedSummaries([steps[0]], [reference], blocks()), undefined);
    source.set("two", source.get("one"));
    assert.equal(resolveOrderedSummaries([steps[0]], [reference, {...reference, entityID: "two"}], source), undefined);
});
