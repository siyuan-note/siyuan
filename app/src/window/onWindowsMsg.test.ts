import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("system lock acknowledges only after all editor input has been submitted", async () => {
    const compiled = transpileModule(readFileSync("src/window/onWindowsMsg.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const submissions: Array<() => void> = [];
    const sent: Array<{channel: string, id: number}> = [];
    const dependencies = {
        Constants: {SIYUAN_WINDOW_WORKSPACE_FLUSH: "siyuan-window-workspace-flush"},
        getAllEditor: () => [undefined, ...[1, 2].map(() => ({
            protyle: {wysiwyg: {}},
            flushPendingTransactions: () => new Promise<void>(resolve => submissions.push(resolve)),
        }))],
        ipcRenderer: {send: (channel: string, id: number) => sent.push({channel, id})},
    };
    const exports = {} as {onWindowsMsg: (message: {cmd: string, data: number}) => void};
    runInNewContext(compiled, {exports, require: () => dependencies, console});
    exports.onWindowsMsg({cmd: "prepareNotebookSystemLock", data: 42});
    assert.equal(submissions.length, 2);
    submissions[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sent.length, 0);
    submissions[1]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(sent, [{channel: "siyuan-notebook-system-lock-ready", id: 42}]);
});

test("maintenance acknowledges save failure and restores shortcuts only after the final task", async () => {
    const compiled = transpileModule(readFileSync("src/window/onWindowsMsg.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const tasks = new Set<string>();
    const messages: Array<{channel: string; data: {id: string; saved: boolean}}> = [];
    let restored = 0;
    const dependencies = {
        Constants: {}, getAllEditor: () => [{protyle: {wysiwyg: {}}, flushPendingTransactions: () => Promise.reject()}],
        setNativeSettingTask: (id: string, active: boolean) => active ? tasks.add(id) : tasks.delete(id),
        hasNativeSettingTasks: () => tasks.size > 0, sendUnregisterGlobalShortcut() {},
        sendGlobalShortcut: () => { restored++; },
        ipcRenderer: {send: (channel: string, data: {id: string; saved: boolean}) => messages.push({channel, data})},
    };
    const exports = {} as {onWindowsMsg: (message: {cmd: string; data: string}) => void};
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {ws: {app: {}}}}, console});
    exports.onWindowsMsg({cmd: "prepareSettingTask", data: "native-1"});
    exports.onWindowsMsg({cmd: "prepareSettingTask", data: "native-2"});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages.length, 2);
    assert.equal(messages.every(message => message.channel === "siyuan-settings-task-ready" && !message.data.saved), true);
    exports.onWindowsMsg({cmd: "endSettingTask", data: "native-1"});
    assert.equal(restored, 0);
    exports.onWindowsMsg({cmd: "endSettingTask", data: "native-2"});
    assert.equal(restored, 1);
});
