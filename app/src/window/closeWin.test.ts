import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import type {Protyle} from "../protyle";

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

test("last-tab closing respects window type, settings, remaining tabs and save-time changes", async () => {
    const compiled = transpileModule(readFileSync("src/window/closeWin.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    let detached = true;
    let tabs: {headElement?: object}[] = [{}];
    let finish: (saved: boolean) => void;
    const calls: string[] = [];
    const state = {config: {fileTree: {closeWindowOnLastTabClosed: true}},
        layout: {centerLayout: {}}, languages: {windowWorkspaceSaveError: "error"}};
    const dependencies = {
        Constants: {SIYUAN_CMD: "cmd"},
        ipcRenderer: {send: (_channel: string, cmd: string) => calls.push(cmd)},
        flushWindowWorkspace: () => new Promise<boolean>(resolve => {
            calls.push("save");
            finish = resolve;
        }),
        destroyWindowPluginKernels: () => calls.push("plugins"),
        showMessage: () => calls.push("error"),
        isWindow: () => detached,
        getAllTabs: () => tabs,
    };
    const api = {} as {closeWindowAfterLastTab: (app: object) => Promise<void>};
    runInNewContext(compiled, {exports: api, require: () => dependencies, window: {siyuan: state}, console});
    detached = false;
    await api.closeWindowAfterLastTab({});
    detached = true;
    state.config.fileTree.closeWindowOnLastTabClosed = false;
    await api.closeWindowAfterLastTab({});
    state.config.fileTree.closeWindowOnLastTabClosed = true;
    tabs = [{}, {headElement: {}}]; // Another split still contains a tab.
    await api.closeWindowAfterLastTab({});
    tabs = [{}];
    const replacement = api.closeWindowAfterLastTab({});
    tabs.push({headElement: {}});
    await replacement;
    assert.deepEqual(calls, []);

    tabs = [{}];
    const interrupted = api.closeWindowAfterLastTab({});
    await Promise.resolve();
    tabs.push({headElement: {}});
    finish(true);
    await interrupted;
    assert.deepEqual(calls, ["save"]);

    tabs = [{}];
    const failed = api.closeWindowAfterLastTab({});
    await Promise.resolve();
    finish(false);
    await failed;
    assert.deepEqual(calls, ["save", "save", "error"]);
    const closed = api.closeWindowAfterLastTab({});
    await Promise.resolve();
    finish(true);
    await closed;
    assert.deepEqual(calls, ["save", "save", "error", "save", "plugins", "destroy"]);
});

test("last-tab closing waits for input and transactions from all removed tabs", async () => {
    const compiled = transpileModule(readFileSync("src/window/closeWin.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const calls: string[] = [];
    const dependencies = {
        Constants: {SIYUAN_CMD: "cmd"},
        ipcRenderer: {send: (_channel: string, cmd: string) => calls.push(cmd)},
        flushWindowWorkspace: async () => { calls.push("workspace"); return true; },
        destroyWindowPluginKernels: () => calls.push("plugins"),
        showMessage: () => calls.push("error"),
        isWindow: () => true, getAllTabs: () => [{}],
    };
    const api = {} as {
        closeWindowAfterLastTab: (app: object) => Promise<void>;
        flushClosingWindowTab: (editor: Protyle) => void;
    };
    runInNewContext(compiled, {exports: api, require: () => dependencies,
        console: {error: () => calls.push("save-failed")}, window: {siyuan: {
            config: {fileTree: {closeWindowOnLastTabClosed: true}},
            layout: {centerLayout: {}}, languages: {windowWorkspaceSaveError: "error"},
        }}});
    let finishFirst: () => void;
    let finishSecond: () => void;
    api.flushClosingWindowTab({flushPendingTransactions: () => new Promise<void>(resolve => finishFirst = resolve)} as Protyle);
    api.flushClosingWindowTab({flushPendingTransactions: () => new Promise<void>(resolve => finishSecond = resolve)} as Protyle);
    const closed = api.closeWindowAfterLastTab({});
    finishSecond();
    await Promise.resolve();
    assert.deepEqual(calls, []);
    finishFirst();
    await closed;
    assert.deepEqual(calls, ["workspace", "plugins", "destroy"]);

    calls.length = 0;
    api.flushClosingWindowTab({flushPendingTransactions: async (): Promise<void> => { throw Error("failed"); }} as Protyle);
    await api.closeWindowAfterLastTab({});
    assert.deepEqual(calls, ["save-failed", "error"]);
});
