import * as assert from "node:assert/strict";
import test from "node:test";
import {
    getLegacyPluginTopBarEntryKey,
    getPluginTopBarEntryKey,
    isPluginTopBarEntryKey,
} from "./topBarKey";

test("plugin top bar keys encode dotted names and IDs without ambiguity", () => {
    const dottedPlugin = getPluginTopBarEntryKey("plugin.name", "entry");
    const dottedEntry = getPluginTopBarEntryKey("plugin", "name.entry");
    assert.equal(dottedPlugin, "plugin:plugin%2Ename:entry");
    assert.equal(dottedEntry, "plugin:plugin:name%2Eentry");
    assert.notEqual(dottedPlugin, dottedEntry);
    assert.equal(dottedPlugin.includes("."), false);
    assert.equal(dottedEntry.includes("."), false);
});

test("plugin top bar keys encode path and delimiter characters", () => {
    const key = getPluginTopBarEntryKey("plugin/name:one", "entry/name:one");
    assert.equal(key, "plugin:plugin%2Fname%3Aone:entry%2Fname%3Aone");
    assert.equal(isPluginTopBarEntryKey(key), true);
    assert.equal(isPluginTopBarEntryKey("plugin:plugin.name:entry"), true);
    assert.equal(isPluginTopBarEntryKey("plugin:missing"), false);
});

test("legacy plugin top bar keys use a distinct best-effort index namespace", () => {
    assert.equal(getLegacyPluginTopBarEntryKey("plugin.name", 2),
        "plugin:plugin%2Ename:legacy-index%3A2");
    assert.notEqual(getLegacyPluginTopBarEntryKey("plugin", 2),
        getPluginTopBarEntryKey("plugin", "2"));
});
