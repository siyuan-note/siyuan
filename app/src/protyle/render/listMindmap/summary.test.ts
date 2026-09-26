import * as assert from "node:assert/strict";
import test from "node:test";
import {getListMindmapSummaryRange, layoutListMindmapSummaries, normalizeListMindmapSummaries} from "./summary";
import type {ListMindmapSummary} from "./summary";
import type {ListMindmapModel, ListMindmapNode} from "./model";

const summary = (nodeIds = ["a", "b", "c"]): ListMindmapSummary => ({id: "s", parentId: "root", nodeIds, label: "Summary"});
const siblings = (...ids: string[]) => new Map([["root", ids]]);

test("summary membership follows insertions, removal and moves without absorbing existing outsiders", () => {
    const original = summary();
    const before = siblings("a", "b", "c", "d");
    const normalize = (ids: string[], moved?: string[]) => normalizeListMindmapSummaries([original],
        siblings(...ids), before, new Set(moved))[0]?.nodeIds;
    assert.deepEqual(normalize(["a", "new", "b", "c", "d"]), ["a", "new", "b", "c"]);
    assert.deepEqual(normalize(["new", "a", "b", "c", "d"]), ["a", "b", "c"]);
    assert.deepEqual(normalize(["a", "c", "d"]), ["a", "c"]);
    assert.deepEqual(normalize(["c", "d"]), ["c"]);
    assert.equal(normalize(["d"]), undefined);
    assert.deepEqual(normalize(["a", "b", "d", "c"], ["c"]), ["a", "b"]);
    assert.deepEqual(normalize(["b", "a", "c", "d"], ["a"]), ["b", "a", "c"]);
    assert.deepEqual(original, summary());
    const pair = [summary(["a", "b"])];
    assert.deepEqual(normalizeListMindmapSummaries(pair, siblings("b", "d", "a"), before, new Set(["a"]))[0].nodeIds, ["b"]);
    assert.deepEqual(normalizeListMindmapSummaries(pair, new Map([["other", ["a", "b"]]]), before), []);
});

const makeModel = (): ListMindmapModel => {
    const make = (id: string, parentId?: string): ListMindmapNode => ({id, parentId, children: [],
        contentBlocks: [], virtual: false, collapsed: false});
    const root = make("root");
    root.children = [make("a", "root"), make("b", "root"), make("c", "root")];
    root.children[0].children = [make("nested", "a")];
    return {list: undefined, root, nodes: new Map([root, ...root.children, ...root.children[0].children].map(node => [node.id, node])),
        metadata: {version: 1, nodes: {}, relations: []}};
};

test("summary creation accepts sibling ranges and rejects cross-level, overlapping and nested groups", () => {
    const model = makeModel();
    assert.deepEqual(getListMindmapSummaryRange(model, "c", "a"), ["a", "b", "c"]);
    assert.deepEqual(getListMindmapSummaryRange(model, "a", "nested"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "root", "root"), []);
    model.metadata.summaries = [summary(["a", "b"])];
    assert.deepEqual(getListMindmapSummaryRange(model, "b", "c"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "nested", "nested"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "c", "c"), ["c"]);
});

test("summary brackets cover visible descendants and disappear with their members", () => {
    const model = makeModel();
    model.metadata.summaries = [summary(["a", "b"])];
    const positions = new Map([
        ["a", {id: "a", x: 100, y: 40, width: 100, height: 40}],
        ["b", {id: "b", x: 100, y: 160, width: 120, height: 50}],
        ["nested", {id: "nested", x: 240, y: 20, width: 200, height: 90}],
    ]);
    const sizes = new Map([["s", {width: 150, height: 60}]]);
    const expanded = layoutListMindmapSummaries(model, positions, sizes).get("s");
    assert.equal(expanded.x, 476);
    assert.equal(expanded.top, 12);
    assert.equal(expanded.bottom, 218);
    positions.delete("nested");
    assert.equal(layoutListMindmapSummaries(model, positions, sizes).get("s").x, 256);
    positions.delete("a");
    assert.equal(layoutListMindmapSummaries(model, positions, sizes).size, 0);
});
