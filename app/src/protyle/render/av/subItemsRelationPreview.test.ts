import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getSubItemsInitialParentKey, getSubItemsRelationPairs, getSubItemsRelationPreview} from "./subItemsRelationPreview";

const field = (id: string, back: string): IAVColumn => ({id, name: id, type: "relation",
    relation: {avID: "db", isTwoWay: true, backKeyID: back}} as IAVColumn);
const pair = getSubItemsRelationPairs([field("parent", "children"), field("children", "parent")], "db")[0];
const row = (id: string, title: string, parents: string[] = [], children: string[] = []): IAVRow => ({id, cells: [
    {valueType: "block", value: {type: "block", block: {id: `bound-${id}`, content: title}}},
    {value: {keyID: "parent", relation: {blockIDs: parents}}},
    {value: {keyID: "children", relation: {blockIDs: children}}},
]});
const source = (rows: IAVRow[]) => ({id: "db", view: {rows}} as IAV);

test("reciprocal self-relations become one choice while incomplete and foreign pairs stay out", () => {
    const foreign = {...field("foreign", "parent"), relation: {avID: "other", isTwoWay: true, backKeyID: "parent"}} as IAVColumn;
    const fields = [pair.first, pair.second, field("missing", "absent"), field("self", "self"), foreign];
    assert.deepEqual(getSubItemsRelationPairs(fields, "db"), [pair]);
});

test("real item identities form a preview and reversing uses the same relation in the other direction", () => {
    const data = source([row("project", "Project"), row("task", "Task", ["project"])]);
    const before = JSON.stringify(data);
    assert.deepEqual(getSubItemsRelationPreview(data, pair, "parent").examples, [{title: "Project", children: ["Task"]}]);
    assert.deepEqual(getSubItemsRelationPreview(data, pair, "children").examples, [{title: "Task", children: ["Project"]}]);
    assert.equal(JSON.stringify(data), before);
});

test("an observed one-to-many direction defaults to its single-parent inverse and preserves configured direction", () => {
    const data = source([row("project", "Project", [], ["one", "two"]), row("one", "One", ["project"]), row("two", "Two", ["project"])]);
    const reversedPair = {...pair, first: pair.second, second: pair.first};
    assert.equal(getSubItemsInitialParentKey(data, reversedPair), "parent");
    assert.equal(getSubItemsInitialParentKey(data, reversedPair, "children"), "children");
    assert.equal(getSubItemsRelationPreview(data, pair, "children").multipleParents, true);
    assert.equal(getSubItemsRelationPreview(data, pair, "parent").multipleParents, false);
});

test("gallery groups deduplicate repeated items and resolve off-page titles from existing relation values", () => {
    const item = row("task", "Task", ["off-page"]);
    item.cells[1].value.relation.contents = [{type: "block", block: {content: "Off-page project"}}];
    const group = {cards: [{id: item.id, values: item.cells}]};
    const data = {view: {groups: [group, group]}} as unknown as IAV;
    assert.deepEqual(getSubItemsRelationPreview(data, pair, "parent").examples,
        [{title: "Off-page project", children: ["Task"]}]);
});

test("empty values and unnamed references do not invent example items", () => {
    assert.deepEqual(getSubItemsRelationPreview(undefined, pair, "parent").examples, []);
    const item = row("empty", "");
    item.cells[1].value.relation.blockIDs = null;
    assert.deepEqual(getSubItemsRelationPreview(source([item]), pair, "parent").examples, []);
    assert.deepEqual(getSubItemsRelationPreview(source([row("task", "Task", ["unknown"])]), pair, "parent").examples, []);
});

test("preview work and output remain bounded for a loaded 10000-item view", () => {
    let reads = 0;
    const rows = Array.from({length: 10000}, (_, index) => ({id: String(index), get cells() {
        reads++;
        assert.ok(index < 100, "preview traversed beyond its loaded sample budget");
        return row(String(index), `Task ${index}`, ["project"]).cells;
    }}));
    const data = source([row("project", "Project"), ...rows]);
    const preview = getSubItemsRelationPreview(data, pair, "parent");
    assert.ok(reads <= 100);
    assert.equal(preview.examples[0].children.length, 3);
    assert.equal(preview.examples.length, 1);
});
