import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("task snapshots cannot undo newer notifications and concurrent tasks remain blocked", () => {
    const code = transpileModule(readFileSync(resolve("src/config/setting/taskBlocker.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const active = new Set<string>();
    const interceptors: Array<(event: Event) => void> = [];
    const api: {applySettingTask?: (data: object) => void; syncSettingTasks?: (data: object) => void} = {};
    runInNewContext(code, {exports: api, window: {addEventListener: (_type: string, callback: (event: Event) => void) => interceptors.push(callback)},
        require: () => ({progressLoading: (data: {code: number}, id: string) => {
            if (data.code === 2) active.delete(id); else active.add(id);
        }})});
    api.applySettingTask({id: "1", active: true, revision: 1, message: ""});
    api.applySettingTask({id: "2", active: true, revision: 2, message: ""});
    api.applySettingTask({id: "1", active: false, revision: 3, message: ""});
    api.syncSettingTasks({revision: 1, tasks: [{id: "1", active: true, message: ""}]});
    assert.deepEqual([...active], ["setting-task-2"]);
    let blocked = false;
    interceptors[0]({preventDefault: () => { blocked = true; }, stopImmediatePropagation() {}} as Event);
    assert.equal(blocked, true);
    api.syncSettingTasks({revision: 4, tasks: []});
    assert.equal(active.size, 0);
    blocked = false;
    interceptors[0]({preventDefault: () => { blocked = true; }, stopImmediatePropagation() {}} as Event);
    assert.equal(blocked, false);
});
