import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";

test("task snapshots cannot undo newer notifications and concurrent tasks remain blocked", () => {
    const active = new Set<string>();
    const interceptors: Array<(event: Event) => void> = [];
    const api = loadModule<{applySettingTask?: (data: object) => void; syncSettingTasks?: (data: object) => void}>(
        "src/config/setting/taskBlocker.ts", {
            window: {addEventListener: (_type: string, callback: (event: Event) => void) => interceptors.push(callback)},
            require: () => ({progressLoading: (data: {code: number}, id: string) => {
                if (data.code === 2) active.delete(id); else active.add(id);
            }}),
        }, ScriptTarget.ES2021);
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
