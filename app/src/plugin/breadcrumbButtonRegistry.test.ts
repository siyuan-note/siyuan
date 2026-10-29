import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {BreadcrumbButtonRegistry, type IBreadcrumbButtonOptions, breadcrumbButtonRegistry,
    getBreadcrumbButtonCatalogSnapshot, getPluginBreadcrumbEntryKey} from "./breadcrumbButtonRegistry";

const button = (id: string, title = id) => ({
    id,
    icon: "iconFullscreen",
    title,
    callback: () => undefined,
}) as IBreadcrumbButtonOptions;

describe("BreadcrumbButtonRegistry", () => {
    it("encodes dotted plugin names and IDs as distinct stable configuration keys", () => {
        assert.equal(getPluginBreadcrumbEntryKey("plugin.a", "button:b"), "plugin:plugin%2Ea:button%3Ab");
        assert.notEqual(getPluginBreadcrumbEntryKey("a:b", "c"), getPluginBreadcrumbEntryKey("a", "b:c"));
        assert.notEqual(getPluginBreadcrumbEntryKey("a.b", "c"), getPluginBreadcrumbEntryKey("a", "b.c"));
    });

    it("exposes current button labels to settings without serializing callbacks", () => {
        breadcrumbButtonRegistry.set("snapshot-plugin", button("a", "Original"));
        breadcrumbButtonRegistry.set("snapshot-plugin", button("a", "Updated"));
        assert.deepEqual(getBreadcrumbButtonCatalogSnapshot(), [{
            key: "plugin:snapshot-plugin:a", label: "snapshot-plugin - Updated",
        }]);
        breadcrumbButtonRegistry.removePlugin("snapshot-plugin");
        assert.deepEqual(getBreadcrumbButtonCatalogSnapshot(), []);
    });

    it("replaces a button without changing its position", () => {
        const registry = new BreadcrumbButtonRegistry();
        registry.set("plugin-a", button("first"));
        registry.set("plugin-a", button("second"));

        assert.equal(registry.set("plugin-a", button("first", "updated")), true);
        assert.deepEqual(registry.getAll().map(item => [item.pluginName, item.options.id, item.options.title]), [
            ["plugin-a", "first", "updated"],
            ["plugin-a", "second", "second"],
        ]);
    });

    it("appends a re-added button to the end of its plugin group", () => {
        const registry = new BreadcrumbButtonRegistry();
        registry.set("plugin-a", button("first"));
        registry.set("plugin-b", button("only"));
        registry.set("plugin-a", button("second"));
        registry.remove("plugin-a", "first");
        registry.set("plugin-a", button("first"));

        assert.deepEqual(registry.getAll().map(item => `${item.pluginName}/${item.options.id}`), [
            "plugin-a/second",
            "plugin-a/first",
            "plugin-b/only",
        ]);
        assert.equal(registry.getNextPluginName("plugin-a"), "plugin-b");
    });

    it("removes all registrations owned by an unloaded plugin", () => {
        const registry = new BreadcrumbButtonRegistry();
        registry.set("plugin-a", button("first"));
        registry.set("plugin-b", button("second"));

        assert.equal(registry.removePlugin("plugin-a"), true);
        assert.deepEqual(registry.getAll().map(item => item.pluginName), ["plugin-b"]);
        assert.equal(registry.remove("plugin-a", "unknown"), false);
    });
});
