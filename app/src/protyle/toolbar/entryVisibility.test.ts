import * as assert from "node:assert/strict";
import test from "node:test";
import {DESKTOP_TOOLBAR_ENTRIES, getDefaultToolbar, getToolbarEntryId} from "./defaults";
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

test("toolbar applies configured order while preserving plugin slots", () => {
    const plugin = {};
    const result = resolve([{key: "a"}, plugin, {key: "b"}, {key: "c"}], {
        order: ["c", "b", "a"],
    });
    assert.deepEqual(result.ordered, [{key: "c"}, plugin, {key: "b"}, {key: "a"}]);
});

test("toolbar hides configured entries without hiding plugin entries", () => {
    const plugin = {};
    const result = resolve([{key: "a"}, plugin, {key: "b"}], {hidden: ["a", "b"]});
    assert.deepEqual(result.visible, [plugin]);
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
