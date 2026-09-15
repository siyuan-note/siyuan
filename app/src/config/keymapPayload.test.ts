import * as assert from "node:assert/strict";
import {test} from "node:test";
import {keymapPayload} from "./keymapPayload";
import {systemConfigCollections} from "./systemConfig";
import {clearDisallowedKeymapItems} from "../util/hotKeyPolicy";

test("shortcut payload accepts missing plugin configuration after first boot defaults are merged", () => {
    for (const plugin of [undefined, null, {}]) {
        const {keymap} = systemConfigCollections({keymap: {
            general: {command: {custom: "", default: "key"}},
            editor: {general: {}, heading: {}, insert: {}, list: {}, table: {}},
            plugin,
        }, uiLayout: {}});
        const before = JSON.stringify(keymap);
        assert.deepEqual(keymapPayload(keymap), {...keymap, plugin: {}});
        assert.equal(JSON.stringify(keymap), before);
    }
});

test("shortcut payload preserves plugin bindings and extension fields", () => {
    const {keymap} = systemConfigCollections({keymap: {
        general: {},
        editor: {general: {}, heading: {}, insert: {}, list: {}, table: {}},
        plugin: {example: {command: {custom: "key", default: "key", bindings: {
            version: 1, keys: ["key"], priority: {key: 2},
        }, extension: {enabled: true}}}},
    }, uiLayout: {}});
    assert.deepEqual(keymapPayload(keymap), keymap);
});

test("startup shortcut cleanup preserves empty commands from unloaded plugins", () => {
    for (const empty of [null, false, 0, ""]) {
        const {keymap} = systemConfigCollections({keymap: {
            general: {},
            editor: {general: {}, heading: {}, insert: {}, list: {}, table: {}},
            plugin: {unloaded: {empty, valid: {custom: "F1", default: "F1"}}},
        }, uiLayout: {}});
        const before = structuredClone(keymap);
        assert.equal(clearDisallowedKeymapItems(keymap.plugin.unloaded, true), false);
        assert.deepEqual(keymap, before);
        assert.deepEqual(keymapPayload(keymap), before);
    }
});

test("startup shortcut payload preserves empty plugin groups after default updates", () => {
    for (const empty of [null, false, 0, ""]) {
        const {keymap} = systemConfigCollections({keymap: {
            general: {command: {custom: "F1", default: "F2"}},
            editor: {general: {}, heading: {}, insert: {}, list: {}, table: {}},
            plugin: {unloaded: empty, loaded: {command: {custom: "F3", default: "F3"}}},
        }, uiLayout: {}});
        const before = structuredClone(keymap);
        for (const group of Object.values(keymap.plugin)) {
            assert.equal(clearDisallowedKeymapItems(group, true), false);
        }
        assert.deepEqual(keymapPayload(keymap), before);
        assert.deepEqual(keymap, before);
    }
});
