import * as assert from "node:assert/strict";
import test from "node:test";
import {updateDockHotkeyData} from "./hotkey";

test("dock hotkeys use the latest keymap configuration", () => {
    const docks = [{
        type: "agentChat",
        hotkeyLangId: "agentChat",
        hotkey: "",
    }, {
        type: "pluginDock",
        hotkey: "⌘P",
    }] as Config.IUILayoutDockTab[];
    const keymap = {
        agentChat: {default: "", custom: "⌘J"},
    } as Config.IKeymapGeneral;

    updateDockHotkeyData(docks, keymap);

    assert.equal(docks[0].hotkey, "⌘J");
    assert.equal(docks[1].hotkey, "⌘P");
});
