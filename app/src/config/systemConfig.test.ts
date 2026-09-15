import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {systemConfigCollections} from "./systemConfig";
import type {JSONValue, SystemAppConf} from "../types/api";
import {getDefaultKeymapBindings, getKeymapBindings, mergeKeymapDefault, setKeymapBindings} from "../util/keymapBindings";

const existingLayoutDefaults = [undefined, (): Config.IUiLayout => assert.fail("Existing layout must not be reset")];

const searchLayout = (config: JSONValue) => {
    const data: [] = [];
    return {
        left: {data},
        layout: {
            instance: "Layout",
            children: [{
                instance: "Wnd",
                children: [{instance: "Tab", children: {instance: "Search", config}}],
            }],
        },
    };
};

const assertLayoutPreserved = (uiLayout: SystemAppConf["uiLayout"]) => {
    const before = structuredClone(uiLayout);
    for (const defaultLayout of existingLayoutDefaults) {
        const actual = systemConfigCollections({keymap: {}, uiLayout}, defaultLayout);
        assert.equal(actual.uiLayout, uiLayout);
        assert.deepEqual(actual.uiLayout, before);
    }
};

const assertLayoutRejected = (uiLayout: SystemAppConf["uiLayout"]) => {
    const before = structuredClone(uiLayout);
    for (const defaultLayout of existingLayoutDefaults) {
        assert.throws(() => systemConfigCollections({keymap: {}, uiLayout}, defaultLayout), /Invalid dock configuration/);
        assert.deepEqual(uiLayout, before);
    }
};

test("persisted split layout with legacy search subtypes loads without resetting", () => {
    // 保留议题中的完整布局结构，文档标识、标题、搜索词和激活时间均已脱敏。
    // https://github.com/siyuan-note/siyuan/issues/19527#issuecomment-5673357561
    const uiLayout: SystemAppConf["uiLayout"] = JSON.parse(readFileSync(join(__dirname, "testdata/system-config-legacy-search-layout.json"), "utf8"));
    assertLayoutPreserved(uiLayout);
});

test("legacy search subtype selections remain unchanged and do not become grouped filters", () => {
    for (const selected of [false, true]) {
        const subTypes = {h1: selected, h2: selected, h3: selected, h4: selected, h5: selected, h6: selected,
            o: selected, u: selected, t: selected};
        assertLayoutPreserved(searchLayout({subTypes}));
    }
});

test("grouped search subtypes coexist with legacy keys and unknown extension data", () => {
    const groups = {heading: {h1: true, h2: false}, list: {o: true}, listItem: {t: true}};
    assertLayoutPreserved(searchLayout({subTypes: groups}));
    for (const extension of [null, false, 17, "extension", [true], {nested: [null, "data"]}]) {
        assertLayoutPreserved(searchLayout({subTypes: {...groups, h1: false, o: false, future: extension}}));
    }
});

test("search subtype validation preserves absent empty and nullable configurations", () => {
    for (const config of [{}, {subTypes: null}, {subTypes: {}},
        {subTypes: {heading: {}, list: null, listItem: {t: null}}}]) {
        assertLayoutPreserved(searchLayout(config));
    }
});

test("search subtype validation still rejects malformed known groups and selections", () => {
    const invalidObjects: JSONValue[] = [false, 17, "invalid", []];
    const invalidSelections: JSONValue[] = [1, "true", [], {}];
    for (const subTypes of invalidObjects) {
        assertLayoutRejected(searchLayout({subTypes}));
    }
    for (const [group, key] of [["heading", "h1"], ["list", "o"], ["listItem", "t"]]) {
        for (const value of invalidObjects) {
            assertLayoutRejected(searchLayout({subTypes: {h1: true, [group]: value}}));
        }
        for (const value of invalidSelections) {
            assertLayoutRejected(searchLayout({subTypes: {h1: true, [group]: {[key]: value}}}));
        }
    }
});

test("legacy search subtypes do not bypass other search and layout validation", () => {
    const subTypes = {h1: false, o: false};
    for (const config of [{query: true}, {idPath: [1]}, {types: {heading: "true"}}, {replaceTypes: {text: 1}}]) {
        assertLayoutRejected(searchLayout({...config, subTypes}));
    }
    const uiLayout = searchLayout({subTypes});
    assertLayoutRejected({...uiLayout, hideDock: "false"});
    assertLayoutRejected({...uiLayout, left: {data: [[{type: "file", show: "true"}]]}});
    assertLayoutRejected({...uiLayout, layout: {...uiLayout.layout, children: [
        ...uiLayout.layout.children, {instance: "Unexpected"},
    ]}});
});

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
