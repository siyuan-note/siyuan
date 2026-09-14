import * as assert from "node:assert/strict";
import {test} from "node:test";
import {keymapPayload} from "./keymapPayload";
import {systemConfigCollections} from "./systemConfig";

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
