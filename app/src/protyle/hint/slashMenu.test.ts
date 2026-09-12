import * as assert from "node:assert/strict";
import test from "node:test";
import {normalizeSlashMenuSeparators, resolveSlashMenuItems, TSlashMenuItem} from "./slashMenu";

const entry = (entryKey: string, filter = [entryKey]): TSlashMenuItem => ({
    entryKey,
    id: entryKey,
    value: entryKey,
    html: entryKey,
    filter,
});

const separator = (entryKey: string): TSlashMenuItem => ({
    entryKey,
    id: entryKey,
    value: "",
    html: "separator",
});

const resolve = (items: TSlashMenuItem[], options: Partial<Parameters<typeof resolveSlashMenuItems>[1]> = {}) =>
    resolveSlashMenuItems(items, {
        enabled: true,
        hideConfiguredCreate: false,
        key: "",
        order: items.map((item) => item.entryKey),
        visible: () => true,
        ...options,
    });

test("slash menu returns no items when its total switch is disabled", () => {
    assert.deepEqual(resolve([entry("a")], {enabled: false}), []);
});

test("slash menu applies configured order to entries and separators", () => {
    const items = [entry("a"), separator("separator_1"), entry("b")];
    assert.deepEqual(resolve(items, {order: ["b", "separator_1", "a"]}).map((item) => item.entryKey),
        ["b", "separator_1", "a"]);
});

test("slash menu removes empty groups after visibility filtering", () => {
    const items = [separator("separator_1"), entry("a"), separator("separator_2"),
        separator("separator_3"), entry("b"), separator("separator_4")];
    assert.deepEqual(resolve(items, {visible: (entryKey) => entryKey === "b"}).map((item) => item.entryKey), ["b"]);
    assert.deepEqual(resolve(items, {visible: () => false}), []);
});

test("slash menu applies configured visibility to separators", () => {
    const items = [entry("a"), separator("separator_1"), entry("b")];
    assert.deepEqual(resolve(items, {visible: (entryKey) => entryKey !== "separator_1"})
        .map((item) => item.entryKey), ["a", "b"]);
});

test("slash menu search and document-create conditions keep hidden entries out", () => {
    const items = [entry("newFileRef", ["document"]), separator("separator_1"),
        entry("visible", ["document"]), entry("other", ["other"])];
    assert.deepEqual(resolve(items, {hideConfiguredCreate: true, key: "doc"}).map((item) => item.entryKey),
        ["visible"]);
});

test("slash menu keeps the first item for a duplicate plugin entry key", () => {
    const first = entry("plugin:name:item", ["first"]);
    const duplicate = {...entry("plugin:name:item", ["duplicate"]), value: "duplicate"};
    assert.deepEqual(resolve([first, duplicate]), [first]);
});

test("slash menu keeps identical item IDs from different plugins independently configurable", () => {
    const first = {...entry("plugin:first:insert", ["first"]), id: "insert"};
    const second = {...entry("plugin:second:insert", ["second"]), id: "insert"};
    assert.deepEqual(resolve([first, second], {
        order: [second.entryKey, first.entryKey],
        visible: (entryKey) => entryKey !== first.entryKey,
    }), [second]);
});

test("slash menu keeps a plugin item whose ID matches the conditional built-in item", () => {
    const builtin = entry("newFileRef");
    const plugin = {...entry("plugin:name:newFileRef"), id: "newFileRef"};
    assert.deepEqual(resolve([builtin, plugin], {hideConfiguredCreate: true}), [plugin]);
});

test("slash menu separator normalization removes leading, trailing, and consecutive separators", () => {
    const items = [separator("s1"), entry("a"), separator("s2"), separator("s3"), entry("b"), separator("s4")];
    assert.deepEqual(normalizeSlashMenuSeparators(items).map((item) => item.entryKey), ["a", "s2", "b"]);
});

test("lite slash menu hides document-dependent entries and keeps local editing entries", () => {
    const unavailable = ["database", "databaseTableView", "databaseKanbanView", "databaseGalleryView",
        "newFileRef", "newSubDocRef", "template", "blockEmbed", "aiWriting", "widget", "unknown"];
    const available = ["ref", "assets", "heading1", "table", "bold", "mermaid"];
    const items = [...unavailable, ...available].map((id) => entry(id));
    assert.deepEqual(resolve(items, {lite: true}).map((item) => item.id), available);
    assert.deepEqual(resolve(items), items);
    assert.deepEqual(resolve(items, {lite: true, key: "database"}), []);
});

test("lite slash menu only offers uploads when an upload implementation is available", () => {
    const items = [entry("insertAsset"), entry("insertHTMLFile")];
    assert.deepEqual(resolve(items, {lite: true}), []);
    assert.deepEqual(resolve(items, {lite: true, canUpload: true}), items);
});

test("lite slash menu requires plugin opt-in even when its ID matches a built-in entry", () => {
    const hidden = {...entry("plugin:first:bold"), id: "bold"};
    const disabled = {...entry("plugin:second:bold"), id: "bold", showInLite: false};
    const enabled = {...entry("plugin:third:database"), id: "database", showInLite: true};
    const items = [hidden, disabled, enabled];
    assert.deepEqual(resolve(items, {lite: true}), [enabled]);
    assert.deepEqual(resolve(items), items);
    assert.deepEqual(resolve(items, {lite: true, visible: () => false}), []);
});

test("lite slash menu preserves configured order and removes empty groups", () => {
    const items = [separator("separator_1"), entry("database"), separator("separator_2"),
        entry("bold"), separator("separator_3"), entry("template"), separator("separator_4"),
        entry("italic"), separator("separator_5")];
    assert.deepEqual(resolve(items, {lite: true, order: items.map((item) => item.entryKey).reverse()})
        .map((item) => item.entryKey), ["italic", "separator_4", "bold"]);
});
