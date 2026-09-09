import * as assert from "node:assert/strict";
import test from "node:test";
import {getDefaultKeymapBindings, getKeymapBindings, getKeymapItem, IShortcutKeymap, mergeKeymapDefault, normalizeShortcutKey,
    setKeymapBindings, visitKeymapItems} from "./keymapBindings";
import {clearDisallowedKeymapItems} from "./hotKeyPolicy";

test("legacy bindings preserve custom keys and explicitly cleared shortcuts", () => {
    assert.deepEqual(getKeymapBindings({default: "⌘K", custom: "⌘J"}), ["⌘J"]);
    assert.deepEqual(getKeymapBindings({default: "⌘K", custom: ""}), []);
    const item: IShortcutKeymap = {default: "⌘K", custom: "⌘J"};
    setKeymapBindings(item, ["⌘J", "⌘L", "⌘J"]);
    assert.deepEqual(getKeymapBindings(JSON.parse(JSON.stringify(item))), ["⌘J", "⌘L"]);
    assert.equal(item.custom, "⌘J");
    setKeymapBindings(item, []);
    assert.equal(item.custom, "");
    assert.deepEqual(getKeymapBindings(item), []);
});

test("default changes preserve custom bindings and unknown configuration fields", () => {
    const item = {default: "⌘K", custom: "⌘J", extra: {value: 1}, bindings: {version: 1 as const, keys: ["⌘J", "⌘L"]}};
    const merged = mergeKeymapDefault(item, {default: "⌘M", custom: "⌘M"} as typeof item);
    assert.equal(merged.default, "⌘M");
    assert.deepEqual(merged.bindings, item.bindings);
    assert.deepEqual(merged.extra, {value: 1});
    assert.equal(item.default, "⌘K");
});

test("unsupported binding formats are preserved and cannot be overwritten", () => {
    const item = {default: "⌘K", custom: "⌘J", bindings: {version: 2, keys: ["⌘L"]}} as unknown as IShortcutKeymap;
    const original = JSON.stringify(item);
    assert.deepEqual(getKeymapBindings(item), []);
    assert.throws(() => setKeymapBindings(item, ["⌘M"]), /Unsupported/);
    assert.equal(JSON.stringify(item), original);
});

test("removing a binding drops only its priorities and retains plugin defaults", () => {
    const item: IShortcutKeymap = {custom: "⌘J", bindings: {version: 1, keys: ["⌘J", "⌘L"],
        defaults: ["⌘K", "⌘M"], priority: {"editor:⌘J": 2, "global:⌘L": 5}}};
    setKeymapBindings(item, ["⌘L"]);
    assert.deepEqual(item.bindings.priority, {"global:⌘L": 5});
    assert.deepEqual(getDefaultKeymapBindings(item), ["⌘K", "⌘M"]);
    assert.equal(item.custom, "⌘L");
});

test("unsafe text input bindings are removed from the full list", () => {
    const item = {default: "⌘K", custom: "A", bindings: {version: 1 as const, keys: ["A", "⇧B", "⌘L"]}};
    assert.equal(clearDisallowedKeymapItems({item}), true);
    assert.deepEqual(getKeymapBindings(item), ["⌘L"]);
    assert.equal(item.custom, "⌘L");
    assert.equal(clearDisallowedKeymapItems({item}), false);
});

test("walking bindings includes unloaded plugins without traversing extension data", () => {
    const keymap = {general: {test: {custom: "⌘K"}}, editor: {insert: {bold: {custom: "⌘B"}}},
        plugin: {unloaded: {action: {custom: "⌘L", bindings: {version: 1, keys: ["⌘L", "⌘M"]}}}}};
    const paths: string[][] = [];
    visitKeymapItems(keymap, (_item, path) => paths.push(path));
    assert.deepEqual(paths, [["general", "test"], ["editor", "insert", "bold"], ["plugin", "unloaded", "action"]]);
    assert.equal(getKeymapItem(keymap, ["general", "test"]).custom, "⌘K");
    assert.equal(getKeymapItem(keymap, ["__proto__", "test"]), undefined);
});

test("portable modifier normalization retains the platform-specific deletion exception", () => {
    assert.equal(normalizeShortcutKey("⌃⇧K", false), "⇧⌘K");
    assert.equal(normalizeShortcutKey("⌃⌥⇧K", false), "⌥⇧⌘K");
    assert.equal(normalizeShortcutKey("⌃D", false), "");
    assert.equal(normalizeShortcutKey("⌃D", true), "⌃D");
});
