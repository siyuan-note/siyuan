import * as assert from "node:assert/strict";
import test from "node:test";
import {addListMindmapSummaryRanges, getListMindmapSummaryRange, getListMindmapSummarySelection, isListMindmapSummaryCrossing,
    layoutListMindmapSummaries, normalizeListMindmapSummaries} from "./summary";
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

test("summary creation accepts contained ranges and rejects cross-level, crossing and duplicate groups", () => {
    const model = makeModel();
    assert.deepEqual(getListMindmapSummaryRange(model, "c", "a"), ["a", "b", "c"]);
    assert.deepEqual(getListMindmapSummaryRange(model, "a", "nested"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "root", "root"), []);
    model.metadata.summaries = [summary(["a", "b"])];
    assert.deepEqual(getListMindmapSummaryRange(model, "b", "c"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "nested", "nested"), ["nested"]);
    assert.deepEqual(getListMindmapSummaryRange(model, "a", "c"), ["a", "b", "c"]);
    assert.deepEqual(getListMindmapSummaryRange(model, "a", "a"), ["a"]);
    assert.deepEqual(getListMindmapSummaryRange(model, "a", "b"), []);
    assert.deepEqual(getListMindmapSummaryRange(model, "c", "c"), ["c"]);
});

test("summary brackets cover visible subtrees, single nodes and disappear with their members", () => {
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
    assert.equal(expanded.top, 9);
    assert.equal(expanded.bottom, 215);
    assert.equal(expanded.labelY + expanded.height / 2, (expanded.top + expanded.bottom) / 2);
    sizes.set("s", {width: 150, height: 400});
    const tall = layoutListMindmapSummaries(model, positions, sizes).get("s");
    assert.equal(tall.top, expanded.top);
    assert.equal(tall.bottom, expanded.bottom);
    assert.equal(tall.labelY + tall.height / 2, (expanded.top + expanded.bottom) / 2);
    model.metadata.summaries = [summary(["a"])];
    const single = layoutListMindmapSummaries(model, positions, sizes).get("s");
    assert.equal(single.top, 9);
    assert.equal(single.bottom, 115);
    assert.equal(single.x, 476);
    model.metadata.summaries = [summary(["a", "b"])];
    positions.delete("nested");
    assert.equal(layoutListMindmapSummaries(model, positions, sizes).get("s").x, 256);
    positions.delete("a");
    assert.equal(layoutListMindmapSummaries(model, positions, sizes).size, 0);
});

test("nested summaries survive normalization regardless of array order and follow structural edits", () => {
    const inner = {...summary(["a", "b"]), id: "inner"};
    const outer = {...summary(["a", "b", "c"]), id: "outer"};
    const before = siblings("a", "b", "c", "d");
    for (const original of [[inner, outer], [outer, inner]]) {
        const normalize = (ids: string[]) => normalizeListMindmapSummaries(original, siblings(...ids), before,
            new Set<string>(), 2);
        assert.deepEqual(normalize(["a", "b", "c", "d"]), original);
        const inserted = normalize(["a", "new", "b", "c", "d"]);
        assert.deepEqual(inserted.find(item => item.id === "inner").nodeIds, ["a", "new", "b"]);
        assert.deepEqual(inserted.find(item => item.id === "outer").nodeIds, ["a", "new", "b", "c"]);
        assert.deepEqual(normalize(["c", "d"]).map(item => item.id), ["outer"]);
        assert.deepEqual(normalize(["d"]), []);
    }
});

test("reordering nested ranges keeps their membership laminar for every sibling permutation", () => {
    const original = [summary(["a", "b", "c", "d", "e"]),
        {...summary(["b", "c", "d"]), id: "inner"}, {...summary(["b", "c"]), id: "deep"}];
    const before = siblings("a", "b", "c", "d", "e", "outside");
    const permutations = (ids: string[]): string[][] => ids.length ? ids.flatMap((id, index) =>
        permutations(ids.filter((_id, i) => i !== index)).map(rest => [id, ...rest])) : [[]];
    for (const ids of permutations(before.get("root"))) {
        const normalized = normalizeListMindmapSummaries(original, siblings(...ids), before, new Set(["b"]), 2);
        normalized.forEach((a, index) => normalized.slice(index + 1).forEach(b => {
            assert.equal(isListMindmapSummaryCrossing(a.nodeIds, b.nodeIds), false, JSON.stringify({ids, normalized}));
        }));
        const reverse = normalizeListMindmapSummaries([...original].reverse(), siblings(...ids), before, new Set(["b"]), 2);
        assert.deepEqual(reverse.reverse(), normalized);
    }
});

test("a single real root can have a summary without creating a virtual parent block", () => {
    const model = makeModel();
    model.list = {dataset: {nodeId: "list"}} as unknown as HTMLElement;
    assert.deepEqual(getListMindmapSummaryRange(model, "root", "root"), ["root"]);
    assert.deepEqual(getListMindmapSummarySelection(model, new Set(["root", "a"])).ranges,
        [{parentId: "list", nodeIds: ["root"]}]);
});

test("batch selection partitions contiguous siblings, omits descendants and detects conflicts", () => {
    const model = makeModel();
    assert.deepEqual(getListMindmapSummarySelection(model, new Set(["a", "nested", "c"])), {
        ranges: [{parentId: "root", nodeIds: ["a"]}, {parentId: "root", nodeIds: ["c"]}], conflict: false,
    });
    assert.deepEqual(getListMindmapSummarySelection(model, new Set(["nested", "b"])).ranges, [
        {parentId: "root", nodeIds: ["b"]}, {parentId: "a", nodeIds: ["nested"]},
    ]);
    model.metadata.summaries = [summary(["a", "b"])];
    assert.equal(getListMindmapSummarySelection(model, new Set(["b", "c"])).conflict, true);
    assert.deepEqual(getListMindmapSummarySelection(model, new Set(["a", "b"])).ranges, []);
});

test("batch creation is atomic and upgrades only configurations that require nesting", () => {
    const model = makeModel();
    let next = 0;
    const add = (ranges: {parentId: string, nodeIds: string[]}[]) =>
        addListMindmapSummaryRanges(model, ranges, () => `summary-${++next}`, "Summary");
    const snapshot = JSON.stringify(model.metadata);
    assert.equal(add([{parentId: "root", nodeIds: ["a"]}, {parentId: "root", nodeIds: ["b", "missing"]}]), undefined);
    assert.equal(JSON.stringify(model.metadata), snapshot);
    assert.equal(next, 0);
    assert.deepEqual(add([{parentId: "root", nodeIds: ["a", "b"]}]), ["summary-1"]);
    assert.equal(model.metadata.version, 1);
    assert.deepEqual(add([{parentId: "a", nodeIds: ["nested"]}]), ["summary-2"]);
    assert.equal(model.metadata.version, 2);
    assert.equal(add([{parentId: "root", nodeIds: ["b", "c"]}]), undefined);
    assert.equal(model.metadata.summaries.length, 2);
});

test("outer summaries enclose inner brackets and labels independently of persistence order", () => {
    const model = makeModel();
    const inner = {...summary(["a"]), id: "inner"};
    const outer = {...summary(["a", "b"]), id: "outer"};
    const positions = new Map([
        ["a", {id: "a", x: 100, y: 40, width: 100, height: 40}],
        ["b", {id: "b", x: 100, y: 160, width: 120, height: 50}],
        ["nested", {id: "nested", x: 240, y: 20, width: 200, height: 90}],
    ]);
    const sizes = new Map([["inner", {width: 150, height: 60}], ["outer", {width: 180, height: 70}]]);
    model.metadata.summaries = [outer, inner];
    const first = layoutListMindmapSummaries(model, positions, sizes);
    model.metadata.summaries = [inner, outer];
    assert.deepEqual(layoutListMindmapSummaries(model, positions, sizes), first);
    assert.ok(first.get("outer").x > first.get("inner").labelX + first.get("inner").width);
    assert.ok(first.get("outer").top < first.get("inner").top);
    assert.ok(first.get("outer").bottom > first.get("inner").bottom);
});
