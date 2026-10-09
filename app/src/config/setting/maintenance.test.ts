import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

for (const code of [0, -1]) {
    test(`maintenance flushes kernel transactions before running and releases the window block (code ${code})`, async () => {
        const compiled = transpileModule(readFileSync("src/config/setting/maintenance.ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText;
        const calls: string[] = [];
        const dependencies = {
            ipcRenderer: {invoke: async (channel: string) => { calls.push(channel); return "native-1"; }},
            fetchSyncPost: async (path: string) => { calls.push(path); return {code, msg: "Save failed"}; },
            showMessage: () => { calls.push("error"); },
        };
        const exports = {} as {runSettingsMaintenance: (action: () => Promise<void>) => Promise<void>};
        runInNewContext(compiled, {exports, require: () => dependencies, console: {error() {}},
            window: {siyuan: {languages: {settingsPendingSaveError: "Save failed"}}}});
        await exports.runSettingsMaintenance(async () => { calls.push("action"); });
        assert.deepEqual(calls, ["siyuan-settings-task-start", "/api/sqlite/flushTransaction",
            code === 0 ? "action" : "error", "siyuan-settings-task-end"]);
    });
}
