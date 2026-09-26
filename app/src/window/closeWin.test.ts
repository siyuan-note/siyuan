import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("窗口关闭等待持久化，保存失败时保留窗口并允许重试", async () => {
    const compiled = transpileModule(readFileSync("src/window/closeWin.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let finish: (saved: boolean) => void;
    const calls: string[] = [];
    const dependencies = {
        Constants: {SIYUAN_CMD: "cmd"},
        ipcRenderer: {send: (_channel: string, cmd: string) => calls.push(cmd)},
        flushWindowWorkspace: () => new Promise<boolean>(resolve => finish = resolve),
        destroyWindowPluginKernels: () => calls.push("plugins"),
        showMessage: () => calls.push("error"),
    };
    const api = {} as {closeWindow: (app: object) => Promise<void>};
    runInNewContext(compiled, {exports: api, require: () => dependencies,
        window: {siyuan: {languages: {windowWorkspaceSaveError: "error"}}}, console});
    const failed = api.closeWindow({plugins: []});
    await api.closeWindow({plugins: []});
    assert.deepEqual(calls, []);
    finish(false);
    await failed;
    assert.deepEqual(calls, ["error"]);
    const saved = api.closeWindow({plugins: []});
    finish(true);
    await saved;
    assert.deepEqual(calls, ["error", "plugins", "destroy"]);
});
