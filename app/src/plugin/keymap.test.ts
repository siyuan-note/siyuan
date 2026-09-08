import * as assert from "node:assert/strict";
import test from "node:test";
import {ensurePluginKeymap, setPluginKeymapCustom, updatePluginKeymap} from "./keymap";
import {getDefaultKeymapBindings, getKeymapBindings, setKeymapBindings} from "../util/keymapBindings";

const withKeymap = (plugin: Config.IKeymapPlugin, callback: () => void) => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {siyuan: {config: {keymap: {plugin}}}},
    });
    try {
        callback();
    } finally {
        if (windowDescriptor) {
            Object.defineProperty(globalThis, "window", windowDescriptor);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
};

test("updating plugin keymap preserves a custom hotkey", () => {
    withKeymap({plugin: {item: {default: "⌘K", custom: "⌘J"}}}, () => {
        const item = updatePluginKeymap("plugin", "item", "⌘L");
        assert.deepEqual(item, {default: "⌘L", custom: "⌘J"});
    });
});

test("ensuring plugin keymap creates missing levels and repairs malformed items", () => {
    withKeymap({plugin: {broken: {default: "⌘K"}}} as unknown as Config.IKeymapPlugin, () => {
        assert.deepEqual(ensurePluginKeymap("missing", "item", "⌘M"), {
            default: "⌘M",
            custom: "⌘M",
        });
        assert.deepEqual(ensurePluginKeymap("plugin", "broken", "⌘L"), {
            default: "⌘L",
            custom: "⌘L",
        });
    });
});

test("setting a custom plugin hotkey creates a missing editable item", () => {
    const plugin: Config.IKeymapPlugin = {};
    setPluginKeymapCustom(plugin, "plugin", "item", "⌘J", "⌘K");
    assert.deepEqual(plugin, {plugin: {item: {default: "⌘K", custom: "⌘J"}}});
});

test("plugin default lists are available on first registration and preserve custom lists on reload", () => {
    withKeymap({}, () => {
        const item = updatePluginKeymap("test", "command", "", ["⌘K", "⌘L", "⌘K", "A"]);
        assert.deepEqual(item.bindings.keys, ["⌘K", "⌘L"]);
        item.bindings.keys = ["⌘M", "⌘N"];
        item.custom = "⌘M";
        const reloaded = updatePluginKeymap("test", "command", "", ["⌘O"]);
        assert.deepEqual(reloaded.bindings.keys, ["⌘M", "⌘N"]);
        assert.deepEqual(reloaded.bindings.defaults, ["⌘O"]);
        assert.equal(reloaded.custom, "⌘M");
    });
});

test("switching from a default list to a single or empty default preserves custom bindings and updates reset", () => {
    for (const hotkey of ["⌘M", ""]) {
        for (const keys of [["⌘J", "⌘N"], []]) {
            withKeymap({}, () => {
                const item = updatePluginKeymap("test", "command", "", ["⌘K", "⌘L"]);
                setKeymapBindings(item, keys);
                const updated = updatePluginKeymap("test", "command", hotkey);
                assert.deepEqual(getKeymapBindings(updated), keys);
                assert.equal(updated.custom, keys[0] || "");
                assert.deepEqual(getDefaultKeymapBindings(updated), hotkey ? [hotkey] : []);
                setKeymapBindings(updated, getDefaultKeymapBindings(updated));
                assert.deepEqual(getKeymapBindings(updated), hotkey ? [hotkey] : []);
            });
        }
    }
});
