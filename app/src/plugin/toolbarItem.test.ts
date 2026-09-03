import * as assert from "node:assert/strict";
import test from "node:test";
import {
    clearPluginToolbarItems,
    removePluginToolbarItem,
    resolvePluginToolbar,
    setPluginToolbarItem,
} from "./toolbarItem";

const createPlugin = (declared: Array<string | IMenuItem> = []) => ({
    updateProtyleToolbar: (toolbar: Array<string | IMenuItem>) => [...toolbar, ...declared],
});

test("registered toolbar items are appended without mutating their defaults", () => {
    const plugin = createPlugin();
    const item: IMenuItem = {name: "plugin.item", hotkey: "⌘K"};
    setPluginToolbarItem(plugin, item);

    const first = resolvePluginToolbar(plugin, []);
    (first[0] as IMenuItem).hotkey = "⌘J";
    const second = resolvePluginToolbar(plugin, []);

    assert.equal((second[0] as IMenuItem).hotkey, "⌘K");
    assert.notEqual(first[0], second[0]);
});

test("registered toolbar items use upsert semantics and override declarations", () => {
    const plugin = createPlugin([{name: "plugin.item", tip: "Declared"}]);
    setPluginToolbarItem(plugin, {name: "plugin.item", tip: "First"});
    setPluginToolbarItem(plugin, {name: "plugin.item", tip: "Updated"});

    const resolved = resolvePluginToolbar(plugin, []);

    assert.equal(resolved.length, 1);
    assert.equal((resolved[0] as IMenuItem).tip, "Updated");
});

test("removing and clearing registered toolbar items restores declarations", () => {
    const plugin = createPlugin([{name: "declared"}]);
    setPluginToolbarItem(plugin, {name: "dynamic"});
    assert.equal(resolvePluginToolbar(plugin, []).length, 2);

    assert.equal(removePluginToolbarItem(plugin, "dynamic"), true);
    assert.deepEqual(resolvePluginToolbar(plugin, []), [{name: "declared"}]);
    assert.equal(removePluginToolbarItem(plugin, "dynamic"), false);

    setPluginToolbarItem(plugin, {name: "dynamic"});
    clearPluginToolbarItems(plugin);
    assert.deepEqual(resolvePluginToolbar(plugin, []), [{name: "declared"}]);
});
