import * as assert from "node:assert/strict";
import {test} from "node:test";
import {systemConfigCollections} from "./systemConfig";
import type {JSONValue} from "../types/api";
import {getDefaultKeymapBindings, getKeymapBindings, mergeKeymapDefault, setKeymapBindings} from "../util/keymapBindings";

test("system configuration keeps layout and shortcut extension data", () => {
    const width: number = null;
    const value = {
        keymap: {
            extension: {nested: [null, true, 1]},
            editor: {general: {undo: {custom: "", default: "key", extra: 7}}},
            plugin: {pluginName: {command: {custom: "key", bindings: {version: 2, keys: ["key"], extra: true}}}},
        },
        uiLayout: {
            hideDock: false,
            left: {data: [[{type: "plugin-dock", size: {width, height: 80}, extra: {key: 1}}]], pin: true},
            layout: {instance: "Custom", customModelType: "plugin-type", customModelData: [null, {private: "data"}]},
            extension: {nested: [false]},
        },
    };
    const before = JSON.stringify(value);
    const actual = systemConfigCollections(value);
    assert.equal(JSON.stringify(actual), before);
    assert.equal(JSON.stringify(value), before);
    assert.equal(actual.uiLayout, value.uiLayout);
});

test("desktop layout uses the existing falsy left default repair before validation", () => {
    for (const uiLayout of [null, {}, {left: false}, {left: 0}, {hideDock: "bad"}, {right: {}}]) {
        let calls = 0;
        const fallback: Config.IUiLayout = {left: {data: [], pin: false}, layout: {}};
        const actual = systemConfigCollections({keymap: {}, uiLayout}, () => {
            calls++;
            return fallback;
        });
        assert.equal(calls, 1);
        assert.equal(actual.uiLayout, fallback);
    }
});

test("empty and partial keymaps retain the existing later default repair", () => {
    for (const keymap of [null, {}, {general: null}, {general: false}, {editor: 0},
        {editor: {general: false, table: null}, plugin: {pluginName: {command: 0}}}]) {
        const before = JSON.stringify(keymap);
        const actual = systemConfigCollections({keymap, uiLayout: {}});
        assert.equal(JSON.stringify(keymap), before);
        assert.ok(actual.keymap == null || !actual.keymap.general);
    }
});

test("empty center layouts and legacy object children remain accepted", () => {
    const layouts: JSONValue[] = [{}, {instance: "Layout", children: {}},
        {instance: "Layout", children: [{instance: "Wnd", children: {instance: "Tab", children: {}}}]},
        {instance: "Editor", blockId: "id", action: ["future-action"], extra: [null]}];
    for (const layout of layouts) {
        const data: [] = [];
        const value = {keymap: {}, uiLayout: {left: {data}, layout}};
        const actual = systemConfigCollections(value);
        assert.equal(actual.uiLayout, value.uiLayout);
    }
});

test("obsolete scalar shortcuts survive until the existing key cleanup", () => {
    for (const obsolete of [true, 17, "legacy", ["old"]]) {
        const source = {general: {obsolete}, editor: {general: {obsolete}}};
        const before = JSON.stringify(source);
        const actual = systemConfigCollections({keymap: source, uiLayout: {}});
        for (const group of [actual.keymap.general, actual.keymap.editor.general]) {
            assert.ok(Object.prototype.hasOwnProperty.call(group, "obsolete"));
            assert.equal(group.obsolete.custom, undefined);
            assert.deepEqual(mergeKeymapDefault(group.obsolete, {default: "new"}),
                Object.assign({}, obsolete, {default: "new"}));
            delete group.obsolete;
            assert.deepEqual(group, {});
        }
        assert.equal(JSON.stringify(source), before);
    }
});

test("persisted shortcut binding inputs retain consumer normalization", () => {
    for (const version of [1, 2, "future", null]) {
        const bindings = {version, keys: [null, 17, "", "key", "key"], defaults: [false, "default", "default"]};
        const source = {general: {command: {custom: "custom", default: "fallback", bindings}}};
        const actual = systemConfigCollections({keymap: source, uiLayout: {}}).keymap.general.command;
        assert.deepEqual(actual, source.general.command);
        assert.deepEqual(getKeymapBindings(actual), version === 1 ? ["key"] : []);
        assert.deepEqual(getDefaultKeymapBindings(actual), version === 1 ? ["default"] : ["fallback"]);
        if (version !== 1) {
            assert.throws(() => setKeymapBindings(actual, ["replacement"]), /Unsupported/);
            assert.equal(actual.bindings, bindings);
        }
    }
});
