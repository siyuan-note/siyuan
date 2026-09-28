import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import {it} from "node:test";
import * as assert from "node:assert/strict";
import * as ts from "typescript";

it("does not consume the desktop tab menu binding on mobile", () => {
    const calls: string[] = [];
    const exports: any = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "keydown.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const dependencies: Record<string, object> = {
        "../../boot/globalEvent/commonHotkey": {filterHotkey: () => false},
        "../../protyle/util/hotKey": {matchHotKey: () => true},
        "../../command/executor": {execByCommand: () => calls.push("native")},
        "../editor": {getCurrentEditor: () => ({protyle: {toolbar: {}}})},
        "../../command/shortcutRuntime": {dispatchPluginShortcut: () => calls.push("plugin")},
    };
    runInNewContext(source, {
        exports,
        window: {siyuan: {config: {keymap: {general: {switchTab: {custom: "F8"}}}}}},
        require: (name: string) => dependencies[name] || {},
    });
    exports.mobileKeydown({}, {key: "F8", preventDefault: () => calls.push("prevent")});
    assert.deepEqual(calls, ["plugin"]);
});
