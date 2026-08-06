import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobilePluginToolbarItems} from "./pluginToolbar";

describe("getMobilePluginToolbarItems", () => {
    const builtinTypes = ["strong", "em", "inline-memo"];

    it("keeps unique plugin items in their final order", () => {
        const toolbar: Array<string | IMenuItem> = [
            "strong",
            {name: "inline-memo", icon: "iconM"},
            {name: "plugin-a", icon: "iconA"},
            {name: "|"},
            {name: "plugin-a", icon: "iconAChanged"},
            {name: "plugin-b", icon: "iconB"},
        ];

        assert.deepEqual(getMobilePluginToolbarItems(toolbar, builtinTypes), [
            {name: "plugin-a", icon: "iconA"},
            {name: "plugin-b", icon: "iconB"},
        ]);
    });

    it("reflects removed and reordered plugin items", () => {
        const toolbar: Array<string | IMenuItem> = [
            {name: "plugin-b", icon: "iconB"},
            "em",
            {name: "plugin-a", icon: "iconANew"},
        ];

        const pluginItems = getMobilePluginToolbarItems(toolbar, builtinTypes);
        assert.deepEqual(pluginItems.map(item => item.name), ["plugin-b", "plugin-a"]);
        assert.equal(pluginItems[1].icon, "iconANew");
    });
});
