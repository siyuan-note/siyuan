import * as assert from "node:assert/strict";
import test from "node:test";
import {
    DESKTOP_TOOLBAR_ENTRIES,
    getDefaultToolbar,
    getPluginToolbarEntryKey,
    getToolbarEntryId,
    getToolbarEntryLabel,
    markPluginToolbarEntries,
} from "./defaults";
import {normalizeToolbarSeparators, resolveToolbarItems} from "./entryVisibility";

interface IToolbarTestItem {
    key?: string;
    separator?: boolean;
}

const resolve = (items: IToolbarTestItem[], options: {
    hidden?: string[];
    order?: string[];
} = {}) => resolveToolbarItems(items, {
    getKey: (item) => item.key,
    isSeparator: (item) => item.separator === true,
    isVisible: (key) => !(options.hidden || []).includes(key),
    order: options.order || items.flatMap((item) => item.key || []),
});

test("desktop toolbar defaults expose stable configuration identifiers", () => {
    const entries = getDefaultToolbar(false).map((item) => typeof item === "string" ? {name: item} : item);
    assert.deepEqual(entries.map(getToolbarEntryId), DESKTOP_TOOLBAR_ENTRIES.map((item) => item.key));
    assert.equal(getToolbarEntryId({name: "plugin-item"}), undefined);
});

test("plugin toolbar entries use plugin-scoped configuration identifiers", () => {
    const existing = {name: "existing"};
    const pluginItem = {name: "shared.item"};
    const marked = markPluginToolbarEntries([existing], [existing, pluginItem, "|"], "plugin.name",
        (item) => `Plugin - ${item.name}`) as IMenuItem[];
    assert.equal(getToolbarEntryId(existing), undefined);
    assert.equal(getToolbarEntryId(marked[1]), getPluginToolbarEntryKey("plugin.name", "shared.item"));
    assert.equal(getToolbarEntryLabel(marked[1]), "Plugin - shared.item");
    assert.equal(getToolbarEntryId(Object.assign({}, marked[1])),
        getPluginToolbarEntryKey("plugin.name", "shared.item"));
    assert.equal(getToolbarEntryId(marked[2]), getPluginToolbarEntryKey("plugin.name", "1", "separator"));
    assert.notEqual(getPluginToolbarEntryKey("plugin.name", "shared.item"),
        getPluginToolbarEntryKey("another.plugin", "shared.item"));
    assert.notEqual(getPluginToolbarEntryKey("plugin.name", "shared.item"),
        getPluginToolbarEntryKey("plugin", "name.shared.item"));
});

test("toolbar applies configured order while preserving unregistered slots", () => {
    const unregistered = {};
    const result = resolve([{key: "a"}, unregistered, {key: "b"}, {key: "c"}], {
        order: ["c", "b", "a"],
    });
    assert.deepEqual(result.ordered, [{key: "c"}, unregistered, {key: "b"}, {key: "a"}]);
});

test("toolbar hides configured entries without hiding unregistered entries", () => {
    const unregistered = {};
    const result = resolve([{key: "a"}, unregistered, {key: "b"}], {hidden: ["a", "b"]});
    assert.deepEqual(result.visible, [unregistered]);
});

test("toolbar hides a configured plugin entry without hiding unregistered entries", () => {
    const pluginKey = getPluginToolbarEntryKey("plugin.name", "item");
    const unregistered = {};
    const result = resolve([{key: pluginKey}, unregistered], {hidden: [pluginKey]});
    assert.deepEqual(result.visible, [unregistered]);
});

test("toolbar removes empty groups after visibility filtering", () => {
    const result = resolve([
        {key: "separator_1", separator: true},
        {key: "a"},
        {key: "separator_2", separator: true},
        {key: "separator_3", separator: true},
        {key: "b"},
        {key: "separator_4", separator: true},
    ], {hidden: ["a"]});
    assert.deepEqual(result.visible, [{key: "b"}]);
});

test("toolbar separator normalization removes leading, trailing, and consecutive separators", () => {
    const items = [
        {separator: true},
        {key: "a"},
        {separator: true},
        {separator: true},
        {key: "b"},
        {separator: true},
    ];
    assert.deepEqual(normalizeToolbarSeparators(items, (item) => item.separator === true), [
        {key: "a"},
        {separator: true},
        {key: "b"},
    ]);
});
