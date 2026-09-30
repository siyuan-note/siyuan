import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getMobilePluginToolbarItems} from "./pluginToolbar";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

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

    it("does not duplicate the built-in block type picker as a plugin", () => {
        const source = readFileSync(resolve(process.cwd(), "src/mobile/util/keyboardToolbar.ts"), "utf8");
        assert.match(source, /getMobilePluginToolbarItems\(protyle.options.toolbar, Constants.INLINE_TYPE.concat\("font-family", "font-size", "block-type"\)\)/);
        assert.equal((source.match(/<button class="keyboard__action" data-type="block-type"/g) || []).length, 1);
        assert.deepEqual(getMobilePluginToolbarItems([{name: "block-type"}, {name: "plugin-a"}],
            builtinTypes.concat("block-type")), [{name: "plugin-a"}]);
    });
});
