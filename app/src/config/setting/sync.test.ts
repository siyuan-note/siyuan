import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("settings notifications update runtime configuration and refresh the registered tab", async () => {
    const compiled = transpileModule(readFileSync("src/config/setting/sync.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const remounted: string[] = [];
    const config = {editor: {fontSize: 16}, keymap: {}, appearance: {}};
    const dependencies = {
        fetchSyncPost: async () => ({code: 0, data: {conf: {editor: {fontSize: 18}, keymap: {}, appearance: {}}}}),
        systemConfig: (value: unknown) => value, objEquals: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
        editorConfigApi: {apply: (value: {fontSize: number}) => { config.editor = value; }}, appearanceConfigApi: {},
        syncSettingTasks() {}, remountOpenSettingTab: async (tab: string) => { remounted.push(tab); },
        getSettingTabDefs: () => [{id: "editor"}],
    };
    const exports = {} as {refreshSettingConfig: (namespace: string) => Promise<void>};
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {config}}, console});
    await exports.refreshSettingConfig("editor");
    assert.equal(config.editor.fontSize, 18);
    assert.deepEqual(remounted, ["editor"]);
});
