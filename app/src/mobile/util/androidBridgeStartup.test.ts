import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isCallExpression, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("mobile.ts", readFileSync("src/mobile/index.ts", "utf8"), ScriptTarget.ES2022, true);
let callback: string;
const visit = (node: import("typescript").Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "fetchPost" &&
        node.arguments[0]?.getText(source) === '"/api/system/getConf"') {
        callback = node.arguments[2].getText(source);
    }
    node.forEachChild(visit);
};
visit(source);

const startup = (ready?: Promise<void>) => {
    const calls: string[] = [];
    const stop = new Error("script boundary");
    const module = {exports: undefined as (response: unknown) => Promise<void>};
    const scope = {
        module, exports: module.exports,
        window: {JSAndroid: ready ? {ready} : {}},
        Constants: {PROTYLE_CDN: "/protyle", SIYUAN_VERSION: "test"},
        console: {error: () => calls.push("error")},
        finishMobileStartup: () => calls.push("finish"),
        addScriptSync: () => { calls.push("script"); throw stop; },
    };
    runInNewContext(transpileModule(`module.exports = ${callback}`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, scope);
    return {calls, stop, run: () => module.exports({})};
};

test("Android startup waits for the trusted document grant before plugins and native reads", async () => {
    let grant: () => void;
    const scenario = startup(new Promise<void>(resolve => { grant = resolve; }));
    const pending = scenario.run();
    await Promise.resolve();
    assert.deepEqual(scenario.calls, []);
    grant();
    await assert.rejects(pending, error => error === scenario.stop);
    assert.deepEqual(scenario.calls, ["script"]);
});

test("failed Android grants abort initialization without calling native readers", async () => {
    const scenario = startup(Promise.reject(new Error("expired document")));
    await scenario.run();
    assert.deepEqual(scenario.calls, ["error", "finish"]);
});

test("legacy Android and browser startup do not require a new bridge", async () => {
    const scenario = startup();
    await assert.rejects(scenario.run(), error => error === scenario.stop);
    assert.deepEqual(scenario.calls, ["script"]);
});

test("authentication callbacks preserve their synchronous result after the trusted bridge grant", async () => {
    const html = readFileSync("stage/auth.html", "utf8");
    const start = html.indexOf("        let androidBridgeReady = true");
    const end = html.indexOf("        if (window.JSHarmony && window.JSHarmony.getOIDCCallback)", start);
    assert.ok(start > 0 && end > start);
    let grant: () => void;
    const calls: string[] = [];
    const scope = {window: {JSAndroid: {
        ready: new Promise<void>(resolve => { grant = resolve; }),
        getOIDCCallback: () => { calls.push("read"); return "siyuan://callback"; },
    }}, handleOIDCCallback: (value: string) => calls.push(value), console: {error: () => calls.push("error")}};
    const run = runInNewContext(`(async () => {${html.substring(start, end)}})`, scope) as () => Promise<void>;
    const pending = run();
    await Promise.resolve();
    assert.deepEqual(calls, []);
    grant();
    await pending;
    assert.deepEqual(calls, ["read", "siyuan://callback"]);
    calls.length = 0;
    scope.window.JSAndroid.ready = Promise.reject(new Error("expired document"));
    await run();
    assert.deepEqual(calls, ["error"]);
});
