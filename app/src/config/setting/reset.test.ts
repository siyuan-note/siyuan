import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
const {parse} = require("ifdef-loader/preprocessor");

const loadReset = (browser: boolean, mobile: boolean, failed = false) => {
    const calls: string[] = [];
    const source = parse(readFileSync("src/config/setting/reset.ts", "utf8"), {BROWSER: browser, MOBILE: mobile}, false, true);
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
    const api = {} as typeof import("./reset");
    const marker = new Map<string, string>();
    const deps = {
        getAllEditor: () => [{protyle: {wysiwyg: {}}, flushPendingTransactions: async () => {
            calls.push("save editor");
            if (failed) throw new Error("offline");
        }}],
        getAllModels: () => ({graph: [{suspendSettingsSaving: () => {
            calls.push("save graph");
            return () => calls.push("resume graph");
        }}]}),
        setNativeSettingTask: (_id: string, active: boolean) => calls.push(active ? "block" : "unblock"),
        suspendLayoutSaving: async () => { calls.push("suspend layout"); return () => calls.push("resume layout"); },
        settingSaveFailures: () => 0,
        flushSettingSaves: async () => { calls.push("save settings"); },
        fetchSyncPost: async (_path: string, data: {saved: boolean}) => { calls.push("ack " + data.saved); return {code: 0}; },
        getHostCapabilities: () => ({ownsKernel: !browser}),
        isWindow: () => false, isSettingsWindow: () => false,
        exitSiYuan: async () => { calls.push("exit"); },
    };
    class Element { blur() { calls.push("blur"); } }
    runInNewContext(code, {exports: api, require: () => deps, console: {error() {}}, HTMLElement: Element,
        document: {activeElement: new Element()}, sessionStorage: {
            setItem: (key: string, value: string) => marker.set(key, value),
            getItem: (key: string) => marker.get(key), removeItem: (key: string) => marker.delete(key),
        }, window: {setTimeout: () => 1, clearTimeout() {}, location: {reload: () => calls.push("reload")}}});
    return {api, calls};
};

for (const [browser, mobile] of [[false, false], [true, false], [true, true]]) {
    test(`reset saves before reloading and only the local desktop exits (${browser}, ${mobile})`, async () => {
        const {api, calls} = loadReset(browser, mobile);
        await api.prepareSettingsReset({id: "reset", token: "one-use"});
        assert.deepEqual(calls, ["block", "blur", "save editor", ...mobile ? [] : ["suspend layout", "save graph"], "save settings", "ack true"]);
        api.completeSettingsReset({id: "reset", exit: true});
        api.exitAfterSettingsReset();
        assert.deepEqual(calls.slice(-(!browser ? 2 : 1)), !browser ? ["reload", "exit"] : ["reload"]);
    });
}

test("failed editor save rejects reset and cancellation restores editing", async () => {
    const {api, calls} = loadReset(false, false, true);
    await api.prepareSettingsReset({id: "reset", token: "one-use"});
    assert.equal(calls.at(-1), "ack false");
    api.cancelSettingsReset("reset");
    assert.equal(calls.at(-1), "unblock");
    assert.equal(calls.includes("reload"), false);
});

test("cancellation resumes layout saving and prepared reconnect reloads without saving old layout", async () => {
    const {api, calls} = loadReset(false, false);
    await api.prepareSettingsReset({id: "first", token: "a"});
    api.cancelSettingsReset("unrelated");
    assert.equal(calls.includes("resume layout"), false);
    api.cancelSettingsReset("first");
    assert.deepEqual(calls.slice(-3), ["resume layout", "resume graph", "unblock"]);
    await api.prepareSettingsReset({id: "second", token: "b"});
    assert.equal(api.reloadSettingsResetOnReconnect(), true);
    assert.equal(calls.at(-1), "reload");
});
