import * as assert from "node:assert/strict";
import test from "node:test";
import {
    mergeEntryOrder,
    mergeEntryOrderPreservingUnknown,
    moveEntryOrder,
    reorderEntrySlots,
    resolveEntryOrder,
} from "./order";

test("entry order keeps custom order and inserts new entries by their default neighbors", () => {
    assert.deepEqual(mergeEntryOrder(["a", "new", "b", "c"], ["c", "a", "b"]), ["c", "a", "new", "b"]);
});

test("entry order inserts the code block Tab setting before the existing code options", () => {
    assert.deepEqual(mergeEntryOrder(
        ["md29", "md31", "md2", "md27", "saveCodeBlockAsFile"],
        ["saveCodeBlockAsFile", "md27", "md31", "md2"],
    ), ["saveCodeBlockAsFile", "md27", "md29", "md31", "md2"]);
});

test("entry order inserts document sorting after attributes in existing profiles", () => {
    assert.deepEqual(mergeEntryOrder(
        ["rename", "attr", "sort", "riffCard", "search"],
        ["search", "rename", "attr", "riffCard"],
    ), ["search", "rename", "attr", "sort", "riffCard"]);
});

test("entry order ignores unknown and duplicate keys", () => {
    assert.deepEqual(mergeEntryOrder(["a", "b", "c"], ["missing", "c", "c", "a"]), ["c", "a", "b"]);
});

test("entry order can preserve an unknown plugin key and its slot", () => {
    assert.deepEqual(mergeEntryOrderPreservingUnknown(
        ["a", "b", "c"],
        ["c", "plugin.disabled", "a", "b"],
    ), ["c", "plugin.disabled", "a", "b"]);
});

test("entry order preserves the first slot of a duplicate unknown key", () => {
    assert.deepEqual(mergeEntryOrderPreservingUnknown(
        ["a", "b"],
        ["a", "plugin.disabled", "plugin.disabled", "b"],
    ), ["a", "plugin.disabled", "b"]);
});

test("entry order inserts a new known key by default neighbors while preserving unknown slots", () => {
    assert.deepEqual(mergeEntryOrderPreservingUnknown(
        ["a", "new", "b", "c"],
        ["c", "plugin.disabled", "a", "b"],
    ), ["c", "plugin.disabled", "a", "new", "b"]);
});

test("entry order applies a known reorder while preserving unknown slots", () => {
    assert.deepEqual(mergeEntryOrderPreservingUnknown(
        ["a", "b", "c"],
        ["a", "plugin.disabled", "b", "c"],
        ["c", "a", "b"],
    ), ["c", "plugin.disabled", "a", "b"]);
});

test("entry order remains valid when a disabled plugin and its separator return", () => {
    const knownOrder = ["a", "separator_1", "b", "c"];
    const savedOrder = ["plugin:name:item", "a", "separator_6", "b", "separator_1", "c"];
    const separators = new Set(["separator_1", "separator_6"]);
    const merged = mergeEntryOrderPreservingUnknown(
        ["a", "b", "separator_1", "c"],
        savedOrder,
        knownOrder,
        separators,
    );
    assert.deepEqual(merged.filter((key) => knownOrder.includes(key)), knownOrder);
    assert.deepEqual(merged.filter((key) => !knownOrder.includes(key)), ["plugin:name:item", "separator_6"]);
    assert.deepEqual(resolveEntryOrder(
        ["a", "b", "separator_1", "c", "separator_6", "plugin:name:item"],
        merged,
        separators,
    ), merged);
});

test("entry order preserves a disabled plugin-provided separator", () => {
    const knownOrder = ["a", "separator_1", "b", "c"];
    const pluginSeparator = "plugin-separator:name:group";
    const savedOrder = ["plugin:name:item", "a", pluginSeparator, "b", "separator_1", "c"];
    const separators = new Set(["separator_1", pluginSeparator]);
    const merged = mergeEntryOrderPreservingUnknown(
        ["a", "b", "separator_1", "c"],
        savedOrder,
        knownOrder,
        separators,
    );
    assert.deepEqual(merged.filter((key) => knownOrder.includes(key)), knownOrder);
    assert.deepEqual(merged.filter((key) => !knownOrder.includes(key)), ["plugin:name:item", pluginSeparator]);
    assert.deepEqual(resolveEntryOrder(
        ["a", "b", "separator_1", "c", pluginSeparator, "plugin:name:item"],
        merged,
        separators,
    ), merged);
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

test("tab menu ordering handles mutually exclusive and conditional entries", () => {
    const order = [
        "copy",
        "split",
        "unpin",
        "pin",
        "tabToWindow",
        "separator_1",
        "closeRight",
        "closeLeft",
        "closeUnmodified",
        "closeAll",
        "closeOthers",
        "close",
    ];
    const reorder = (pinKey: "pin" | "unpin") => reorderEntrySlots([
        {key: "close"},
        {key: "separator_1"},
        {key: "split"},
        {key: "copy"},
        {key: pinKey},
        {key: "tabToWindow"},
    ], order, (item) => item.key).map((item) => item.key);

    assert.deepEqual(reorder("pin"), ["copy", "split", "pin", "tabToWindow", "separator_1", "close"]);
    assert.deepEqual(reorder("unpin"), ["copy", "split", "unpin", "tabToWindow", "separator_1", "close"]);
});
