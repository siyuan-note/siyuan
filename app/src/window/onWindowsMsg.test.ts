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
