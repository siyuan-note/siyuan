import * as assert from "node:assert/strict";
import test from "node:test";
import {ensurePluginKeymap, setPluginKeymapCustom, updatePluginKeymap} from "./keymap";

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
