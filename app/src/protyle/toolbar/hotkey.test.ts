import * as assert from "node:assert/strict";
import test from "node:test";
import {getToolbarHotkey, markToolbarHotkey} from "./hotkey";
import {markPluginToolbarEntries} from "./defaults";

test("built-in toolbar items resolve all current bindings after configuration changes", () => {
    const item: IMenuItem = {name: "strong", hotkey: "⌘B"};
    markToolbarHotkey(item, "strong");
    const current = {custom: "⌘M", bindings: {version: 1, keys: ["⌘M", "⌘L"]}};
    const copied = {...item};
    markToolbarHotkey(copied, item);
    assert.equal(getToolbarHotkey(copied, {editor: {insert: {bold: current}}}), current);
});

test("explicit per-editor toolbar shortcuts remain independent of the global configuration", () => {
    for (const hotkey of ["⌘J", ""]) {
        const item: IMenuItem = {name: "strong", hotkey};
        markToolbarHotkey(item, item);
        assert.equal(getToolbarHotkey(item, {editor: {insert: {bold: {custom: "⌘B"}}}}), hotkey);
    }
});

test("plugin toolbar bindings are resolved through their actual owner", () => {
    const [item] = markPluginToolbarEntries([], [{name: "action", hotkey: "⌘J"}], "owner", () => "Action");
    const current = {custom: "⌘M", bindings: {version: 1, keys: ["⌘M", "⌘L"]}};
    assert.equal(getToolbarHotkey(item as IMenuItem, {plugin: {owner: {action: current}}}), current);
});
