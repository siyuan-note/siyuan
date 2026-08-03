import * as assert from "node:assert/strict";
import test from "node:test";
import {mergeEntryOrder, moveEntryOrder, reorderEntrySlots, resolveEntryOrder} from "./order";

test("entry order keeps custom order and inserts new entries by their default neighbors", () => {
    assert.deepEqual(mergeEntryOrder(["a", "new", "b", "c"], ["c", "a", "b"]), ["c", "a", "new", "b"]);
});

test("entry order ignores unknown and duplicate keys", () => {
    assert.deepEqual(mergeEntryOrder(["a", "b", "c"], ["missing", "c", "c", "a"]), ["c", "a", "b"]);
});

test("entry order falls back when separators are adjacent or at an edge", () => {
    const separators = new Set(["s1", "s2"]);
    const defaults = ["a", "s1", "b", "s2", "c"];
    assert.deepEqual(resolveEntryOrder(defaults, ["s1", "a", "b", "s2", "c"], separators), defaults);
    assert.deepEqual(resolveEntryOrder(defaults, ["a", "s1", "s2", "b", "c"], separators), defaults);
});

test("entry order rejects drops that create invalid separator positions", () => {
    const separators = new Set(["s1", "s2"]);
    const constrainedOrder = ["a", "s1", "b", "s2", "c"];
    assert.equal(moveEntryOrder(constrainedOrder, "s1", "a", false, separators), undefined);
    assert.equal(moveEntryOrder(constrainedOrder, "b", "s1", false, separators), undefined);
    assert.deepEqual(moveEntryOrder(["a", "x", "s1", "b", "y", "s2", "c"], "a", "s1", true, separators),
        ["x", "s1", "a", "b", "y", "s2", "c"]);
});

test("entry order preserves plugin registration slots", () => {
    const items = [{key: "a"}, {key: "plugin"}, {key: "b"}, {key: "separator"}];
    assert.deepEqual(reorderEntrySlots(items, ["b", "separator", "a"], (item) => item.key),
        [{key: "b"}, {key: "plugin"}, {key: "separator"}, {key: "a"}]);
});
