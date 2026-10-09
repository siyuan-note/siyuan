import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.Latest);
const selected = new Set(["reloadingUI", "reloadUI", "resetLayout"]);
const code = transpileModule(source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(source))))
    .map(statement => statement.getText(source)).join("\n"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = (options: {host?: object; fail?: boolean; readonly?: boolean; storageFail?: boolean;
    save?: () => Promise<void>} = {}) => {
    const calls: string[] = [];
    const api = {} as {reloadUI: () => Promise<void>; resetLayout: () => Promise<void>};
    class Element { blur() { calls.push("blur"); } }
    const storage: Record<string, unknown> = {};
    let failedStorage = false;
    runInNewContext(code, {
        exports: api, console: {error() {}}, HTMLElement: Element,
        document: {activeElement: new Element()},
        window: {siyuan: {config: {readonly: options.readonly}, storage, languages: {}},
            location: {reload: () => calls.push("reload")}},
        getSettingsWindowHost: () => options.host,
        settingSaveFailures: () => 0,
        flushSettingSaves: async () => {
            calls.push("settings");
            if (failedStorage) throw new Error("storage request failed");
            await options.save?.();
        },
        exportLayout: async ({cb}: {cb: () => void}) => {
            calls.push("layout");
            if (options.fail) return;
            await Promise.resolve();
            calls.push("saved");
            cb();
        },
        suspendLayoutSaving: async () => { calls.push("suspend"); return () => calls.push("resume"); },
        fetchSyncPost: async () => { calls.push("clear"); return {code: options.fail ? -1 : 0}; },
        Constants: {LOCAL_FILEPOSITION: "file", LOCAL_DIALOGPOSITION: "dialog"},
        setStorageVal: async (key: string) => { calls.push(key); failedStorage ||= options.storageFail; },
        showMessage: () => calls.push("error"),
    });
    return {api, calls, storage};
};

test("settings reload and layout reset execute in their owner", async () => {
    const owner: string[] = [];
    const {api, calls} = setup({host: {
        reload: async () => { owner.push("reload"); },
        resetLayout: async () => { owner.push("reset"); },
    }});
    await api.reloadUI();
    await api.resetLayout();
    assert.deepEqual(owner, ["reload", "reset"]);
    assert.deepEqual(calls, ["blur", "settings", "blur", "settings"]);
});

test("reload flushes settings and waits for layout callback, combining repeated requests", async () => {
    let ready: () => void;
    const saving = new Promise<void>(resolve => { ready = resolve; });
    const {api, calls} = setup({save: () => saving});
    const first = api.reloadUI();
    await api.reloadUI();
    assert.deepEqual(calls, ["blur", "settings"]);
    ready();
    await first;
    assert.deepEqual(calls, ["blur", "settings", "layout", "saved", "reload"]);
});

test("a failed layout save does not reload and permits a later retry", async () => {
    const {api, calls} = setup({fail: true});
    await api.reloadUI();
    await api.reloadUI();
    assert.equal(calls.includes("reload"), false);
    assert.equal(calls.filter(call => call === "layout").length, 2);
});

test("pending settings failure prevents layout save and reload", async () => {
    const {api, calls} = setup({save: async () => { throw new Error("failed"); }});
    await api.reloadUI();
    assert.deepEqual(calls, ["blur", "settings", "error"]);
});

test("pending child settings finish before owner delegation and failures prevent it", async () => {
    for (const reset of [false, true]) {
        const calls: string[] = [];
        let ready: () => void;
        const pending = new Promise<void>(resolve => { ready = resolve; });
        const host = {reload: async () => { calls.push("reload"); }, resetLayout: async () => { calls.push("reset"); }};
        const {api} = setup({host, save: () => pending});
        const saving = reset ? api.resetLayout() : api.reloadUI();
        assert.deepEqual(calls, []);
        ready();
        await saving;
        assert.deepEqual(calls, [reset ? "reset" : "reload"]);
        const failed = setup({host, save: async () => { throw new Error("offline"); }});
        await (reset ? failed.api.resetLayout() : failed.api.reloadUI());
        assert.equal(calls.length, 1);
        assert.equal(failed.calls.at(-1), "error");
    }
});

test("reset suspends old layout saving and clears storage before reload without export", async () => {
    const {api, calls, storage} = setup();
    await api.resetLayout();
    assert.deepEqual(calls, ["blur", "settings", "suspend", "clear", "file", "dialog", "settings", "reload"]);
    assert.deepEqual(Object.keys(storage).sort(), ["dialog", "file"]);
});

test("failed reset resumes layout saving without clearing positions or reloading", async () => {
    const {api, calls} = setup({fail: true});
    await api.resetLayout();
    assert.deepEqual(calls, ["blur", "settings", "suspend", "clear", "resume", "error"]);
});

test("resolved storage failures still prevent layout reset reload", async () => {
    const {api, calls} = setup({storageFail: true});
    await api.resetLayout();
    assert.equal(calls.includes("reload"), false);
    assert.deepEqual(calls.slice(-3), ["settings", "resume", "error"]);
});

test("readonly layout reset does not write preferences", async () => {
    const {api, calls} = setup({readonly: true});
    await api.resetLayout();
    assert.deepEqual(calls, ["reload"]);
});
