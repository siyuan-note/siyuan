import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getDefaultToolbar, getPluginToolbarEntryKey, getToolbarEntryId, getToolbarEntryLabel,
    markPluginToolbarEntries} from "./defaults";
import {removePluginToolbarItem, resolvePluginToolbar, setPluginToolbarItem} from "../../plugin/toolbarItem";

test("editor toolbar catalog snapshot lists plugin items without an open editor", () => {
    const source = readFileSync("src/protyle/toolbar/catalogSnapshot.ts", "utf8");
    const compiled = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const exports = {} as typeof import("./catalogSnapshot");
    runInNewContext(compiled, {exports, window: {siyuan: {languages: {pluginAction: "Translated action"}}},
        require: (id: string) => {
            if (id === "./defaults") {
                return {getDefaultToolbar, getToolbarEntryId, getToolbarEntryLabel, markPluginToolbarEntries};
            }
            if (id === "./util") {
                return {toolbarKeyToMenu: (items: Array<string | IMenuItem>) => items.map(item =>
                    typeof item === "string" ? {name: item} : item)};
            }
            if (id === "../../plugin/toolbarItem") {
                return {resolvePluginToolbar};
            }
            throw new Error(id);
        }});
    const plugin = {
        name: "example",
        displayName: "Example",
        updateProtyleToolbar: (toolbar: Array<string | IMenuItem>) => [toolbar[0],
            {name: "legacy", lang: "pluginAction"}, "|", ...toolbar.slice(1)],
    };
    setPluginToolbarItem(plugin, {name: "dynamic", tip: "Dynamic action"});
    try {
        const snapshot = exports.getEditorToolbarCatalogSnapshot([plugin]);
        const legacyKey = getPluginToolbarEntryKey("example", "legacy");
        const dynamicKey = getPluginToolbarEntryKey("example", "dynamic");
        assert.deepEqual(Array.from(snapshot, item => item.key).slice(0, 4), [
            "block-type", legacyKey, getPluginToolbarEntryKey("example", "1", "separator"), "block-ref",
        ]);
        assert.equal(snapshot.find(item => item.key === legacyKey)?.label, "Example - Translated action");
        assert.equal(snapshot.find(item => item.key === dynamicKey)?.label, "Example - Dynamic action");
        assert.equal(snapshot.find(item => item.key === dynamicKey)?.separator, false);
        assert.equal(JSON.stringify(snapshot).includes("callback"), false);
        removePluginToolbarItem(plugin, "dynamic");
        assert.equal(exports.getEditorToolbarCatalogSnapshot([plugin]).some(item => item.key === dynamicKey), false);
    } finally {
        removePluginToolbarItem(plugin, "dynamic");
    }
});
