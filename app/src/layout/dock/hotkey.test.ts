import * as assert from "node:assert/strict";
import test from "node:test";
import {getDockHotkey} from "./hotkey";

test("dock hotkeys use the latest keymap configuration", () => {
    const internalDock = {
        type: "agentChat",
        hotkeyLangId: "agentChat",
    } as Config.IUILayoutDockTab;
    const pluginDock = {
        type: "pluginDock",
    } as Config.IUILayoutDockTab;
    const keymap = {
        general: {
            agentChat: {default: "", custom: "⌘J"},
        },
        plugin: {
            plugin: {
                pluginDock: {default: "⌘P", custom: "⌘K"},
            },
        },
    };
    const plugins = [{
        name: "plugin",
        docks: {pluginDock: {}},
    }];

    assert.equal(getDockHotkey(internalDock, keymap, plugins), "⌘J");
    assert.equal(getDockHotkey(pluginDock, keymap, plugins), "⌘K");
    keymap.plugin.plugin.pluginDock.custom = "";
    assert.equal(getDockHotkey(pluginDock, keymap, plugins), "");
    assert.equal(getDockHotkey({...pluginDock, type: "unknown"}, keymap, plugins), "");
});
