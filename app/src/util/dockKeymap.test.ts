import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createDockKeymapDefaults, getSidebarDockOrder, getSidebarKeymap, readSidebarKeymap} from "./dockKeymap";

test("dock defaults share the main application's platform mapping", () => {
    for (const platform of ["win32", "linux", "android", "harmony"]) {
        assert.deepEqual(getSidebarKeymap(undefined, platform), {fileTree: ["⌥1"], outline: ["⌥2"]});
    }
    for (const platform of ["darwin", "ios"]) {
        assert.deepEqual(getSidebarKeymap(undefined, platform), {fileTree: ["⌃1"], outline: ["⌃2"]});
    }
    const defaults = createDockKeymapDefaults("win32");
    assert.deepEqual(defaults.bookmark, {default: "⌥3", custom: "⌥3"});
    assert.deepEqual(defaults.riffCard, {default: "⌥0", custom: "⌥0"});
    defaults.fileTree.custom = "";
    assert.equal(createDockKeymapDefaults("win32").fileTree.custom, "⌥1");
});

test("sidebar projection retains custom bindings, multiple keys and explicit unbinding", () => {
    const keymap = {general: {
        fileTree: {custom: "⌥1", default: "⌥1", bindings: {version: 1, keys: ["⌥3", "⇧⌘J", "⌥3"]}},
        outline: {custom: "", default: "⌥2"}, search: {custom: "⌘F"},
    }};
    assert.deepEqual(getSidebarKeymap(keymap, "win32"), {fileTree: ["⌥3", "⇧⌘J"], outline: []});
    keymap.general.fileTree.bindings.keys = [];
    assert.deepEqual(getSidebarKeymap(keymap, "darwin"), {fileTree: [], outline: []});
    assert.deepEqual(getSidebarKeymap({general: {outline: {custom: "⌥4"}}}, "darwin"),
        {fileTree: ["⌃1"], outline: ["⌥4"]});
});

test("sidebar wire validation projects only two binding arrays and preserves disabled commands", () => {
    assert.deepEqual(readSidebarKeymap({fileTree: ["⌥1", "⌥1", ""], outline: [], secret: "not projected"}),
        {fileTree: ["⌥1"], outline: []});
    for (const value of [null, {}, {fileTree: "⌥1", outline: []}, {fileTree: [], outline: [1]},
        {general: {fileTree: {custom: "⌥1"}}}]) assert.equal(readSidebarKeymap(value), undefined);
});

test("sidebar conflicts follow source Dock order without mutating saved bindings", () => {
    const keymap = {general: {fileTree: {custom: "⌥1", bindings: {version: 1, keys: ["⌥1", "⌥3"]}},
        outline: {custom: "⌥1", bindings: {version: 1, keys: ["⌥1", "⌥4"]}}}};
    const before = JSON.stringify(keymap);
    assert.deepEqual(getSidebarKeymap(keymap, "win32", ["outline", "fileTree"]),
        {fileTree: ["⌥3"], outline: ["⌥1", "⌥4"]});
    assert.deepEqual(getSidebarKeymap(keymap, "win32", ["fileTree", "outline"]),
        {fileTree: ["⌥1", "⌥3"], outline: ["⌥4"]});
    assert.equal(JSON.stringify(keymap), before);
});

test("source Dock order follows the main left, right, bottom and section traversal", () => {
    assert.deepEqual(getSidebarDockOrder({
        left: {data: [[{hotkeyLangId: "bookmark"}], [{hotkeyLangId: "outline"}]]},
        right: {data: [[{hotkeyLangId: "fileTree"}], []]},
        bottom: {data: [[{hotkeyLangId: "tag"}]]},
    }), ["outline", "fileTree"]);
    assert.deepEqual(getSidebarDockOrder({left: {data: [[], [{hotkeyLangId: "fileTree"}]]},
        bottom: {data: [[{hotkeyLangId: "outline"}]]}}), ["fileTree", "outline"]);
    assert.deepEqual(getSidebarDockOrder(), []);
});

test("sidebar conflict ownership normalizes platform-equivalent keys and ignores legacy priorities", () => {
    const keymap = {general: {
        fileTree: {custom: "⌃1", bindings: {version: 1, keys: ["⌃1", "⌘1"], priority: {"global:⌃1": 100}}},
        outline: {custom: "⌘1", bindings: {version: 1, keys: ["⌘1"]}},
    }};
    assert.deepEqual(getSidebarKeymap(keymap, "windows", ["outline", "fileTree"]), {fileTree: [], outline: ["⌘1"]});
    assert.deepEqual(getSidebarKeymap(keymap, "windows", ["fileTree", "outline"]), {fileTree: ["⌃1"], outline: []});
    assert.deepEqual(getSidebarKeymap(keymap, "darwin", ["outline", "fileTree"]), {fileTree: ["⌃1"], outline: ["⌘1"]});
    assert.deepEqual(getSidebarKeymap(keymap, "linux", ["outline", "fileTree"], true), {fileTree: ["⌃1"], outline: ["⌘1"]});
});
