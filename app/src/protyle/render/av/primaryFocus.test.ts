import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

test("new database items focus once without replacing template text or stealing focus on refresh", () => {
    let focused = 0;
    let caret = -1;
    const input = {value: "Template title", focus: () => { focused++; },
        setSelectionRange: (start: number, end: number) => { assert.equal(start, end); caret = start; }};
    const root = {isConnected: true, querySelector: () => ({querySelector: () => input})} as unknown as Element;
    const exports = {};
    const window = {siyuan: {isPublish: false}};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "primaryFocus.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {exports, window, require: () => ({popTextCell: () => assert.fail("plain primary should use its input")})});
    const {focusNewDatabasePrimary} = exports as typeof import("./primaryFocus");
    const request = {avID: "av", itemID: "row", focusPrimary: true};
    const protyle = {options: {}} as IProtyle;
    focusNewDatabasePrimary(root, protyle, request);
    assert.equal(focused, 1);
    assert.equal(caret, input.value.length);
    assert.equal(input.value, "Template title");
    focusNewDatabasePrimary(root, protyle, request);
    assert.equal(focused, 1);
    for (const mode of ["disabled", "publish", "created", "snapshot"]) {
        window.siyuan.isPublish = mode === "publish";
        focusNewDatabasePrimary(root, {disabled: mode === "disabled", options: {history: {[mode]: "archive"}}} as IProtyle,
            {...request, focusPrimary: true});
    }
    assert.equal(focused, 1);
});
