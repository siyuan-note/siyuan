import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    clearDisallowedKeymapItems,
    clearDisallowedTextInputHotkey,
    isDisallowedTextInputHotkey,
    isReservedKeymap,
    normalizePluginHotkey,
} from "./hotKeyPolicy";

describe("text input hotkey policy", () => {
    it("disallows a character without a non-Shift modifier", () => {
        ["A", "z", "0", " ", "/", "+", "你", "🙂", "e\u0301"].forEach((hotkey) => {
            assert.equal(isDisallowedTextInputHotkey(hotkey), true, hotkey);
        });
    });

    it("disallows Shift with a character", () => {
        ["⇧A", "⇧0", "⇧ ", "⇧/", "⇧你", "⇧🙂"].forEach((hotkey) => {
            assert.equal(isDisallowedTextInputHotkey(hotkey), true, hotkey);
        });
    });

    it("allows function and editing keys", () => {
        ["", "F1", "F10", "Home", "⇧F1", "⇧Home", "←", "⇧←", "⇥", "⇧⇥", "↩", "⇧↩"].forEach((hotkey) => {
            assert.equal(isDisallowedTextInputHotkey(hotkey), false, hotkey);
        });
    });

    it("allows a character with a non-Shift modifier", () => {
        ["⌘A", "⌃A", "⌥A", "⇧⌘A", "⌥⇧A", "⌃⌥⇧⌘A"].forEach((hotkey) => {
            assert.equal(isDisallowedTextInputHotkey(hotkey), false, hotkey);
        });
    });

    it("allows Enter only for the agent send shortcut", () => {
        assert.equal(isReservedKeymap("↩", ["general", "agentSend"]), false);
        assert.equal(isReservedKeymap("↩", ["general", "agentChat"]), true);
        assert.equal(isReservedKeymap("↩", ["editor", "general", "insertAfter"]), true);
        assert.equal(isReservedKeymap("⇧↩", ["general", "agentSend"]), true);
    });

    it("clears only disallowed text input hotkeys", () => {
        assert.equal(clearDisallowedTextInputHotkey("⇧S"), "");
        assert.equal(clearDisallowedTextInputHotkey("⇧F1"), "⇧F1");
        assert.equal(clearDisallowedTextInputHotkey("⌘S"), "⌘S");
    });

    it("clears a disallowed plugin default and preserves a valid custom hotkey", () => {
        assert.deepEqual(normalizePluginHotkey("⇧S", "⌘K"), {
            defaultHotkey: "",
            customHotkey: "⌘K",
            ignoredHotkeys: ["⇧S"],
        });
    });

    it("clears a disallowed plugin custom hotkey without restoring the default", () => {
        assert.deepEqual(normalizePluginHotkey("⌘K", "S"), {
            defaultHotkey: "⌘K",
            customHotkey: "",
            ignoredHotkeys: ["S"],
        });
    });

    it("uses a normalized plugin default when no custom hotkey exists", () => {
        assert.deepEqual(normalizePluginHotkey("⇧S"), {
            defaultHotkey: "",
            customHotkey: "",
            ignoredHotkeys: ["⇧S"],
        });
    });

    it("clears only custom hotkeys from the built-in keymap", () => {
        const keymap = {
            invalid: {default: "S", custom: "S"},
            valid: {default: "⌘K", custom: "⌘K"},
        };
        assert.equal(clearDisallowedKeymapItems(keymap), true);
        assert.deepEqual(keymap, {
            invalid: {default: "S", custom: ""},
            valid: {default: "⌘K", custom: "⌘K"},
        });
        assert.equal(clearDisallowedKeymapItems(keymap), false);
    });

    it("clears plugin defaults together with custom hotkeys", () => {
        const keymap = {
            invalid: {default: "⇧S", custom: "A"},
        };
        assert.equal(clearDisallowedKeymapItems(keymap, true), true);
        assert.deepEqual(keymap.invalid, {default: "", custom: ""});
    });
});
