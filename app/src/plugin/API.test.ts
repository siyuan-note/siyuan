import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

it("defers plugin API dependency reads and shares the initialized API", () => {
    const source = readFileSync(resolve(process.cwd(), "src/plugin/API.ts"), "utf8");
    const compiled = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    let dependenciesReady = false;
    const adaptHotkey = (value: string) => value;
    const dependency = new Proxy({}, {
        get(_target, key) {
            assert.ok(dependenciesReady, `Dependency ${String(key)} was read during module initialization`);
            return key === "updateHotkeyTip" ? adaptHotkey : (): void => undefined;
        },
    });
    const exports: {getAPI?: () => {adaptHotkey: typeof adaptHotkey}} = {};
    runInNewContext(compiled, {exports, require: () => dependency});
    dependenciesReady = true;
    const api = exports.getAPI();
    assert.equal(api.adaptHotkey, adaptHotkey);
    assert.equal(exports.getAPI(), api);
});
