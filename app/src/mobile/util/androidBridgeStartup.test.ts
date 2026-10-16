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

const startup = () => {
    const calls: string[] = [];
    const stop = new Error("script boundary");
    const module = {exports: undefined as (response: unknown) => Promise<void>};
    const scope = {
        module, exports: module.exports,
        window: {JSAndroid: {}},
        Constants: {PROTYLE_CDN: "/protyle", SIYUAN_VERSION: "test"},
        console: {error: () => calls.push("error")},
        setStartupLanguage() {},
        setStartupStage() {},
        guardStartup: (callback: (response: unknown) => Promise<void>) => (response: unknown) =>
            callback(response).catch(() => { calls.push("error"); }),
        ensureLute: () => { calls.push("script"); throw stop; },
    };
    runInNewContext(transpileModule(`module.exports = ${callback}`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, scope);
    return {calls, stop, run: () => module.exports({data: {conf: {appearance: {lang: "en"}}}})};
};

test("Android startup initializes the engine without a bridge handshake", async () => {
    const scenario = startup();
    await scenario.run();
    assert.deepEqual(scenario.calls, ["script", "error"]);
});

test("authentication callbacks preserve their synchronous native result", () => {
    const html = readFileSync("stage/auth.html", "utf8");
    const start = html.indexOf("        if (window.JSAndroid && window.JSAndroid.getOIDCCallback)");
    const end = html.indexOf("        if (window.JSHarmony && window.JSHarmony.getOIDCCallback)", start);
    assert.ok(start > 0 && end > start);
    const calls: string[] = [];
    const scope = {window: {JSAndroid: {
        getOIDCCallback: () => { calls.push("read"); return "siyuan://callback"; },
    }}, handleOIDCCallback: (value: string) => calls.push(value), console: {error: () => calls.push("error")}};
    runInNewContext(html.substring(start, end), scope);
    assert.deepEqual(calls, ["read", "siyuan://callback"]);
});
