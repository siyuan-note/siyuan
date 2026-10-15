import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";

test("database items focus once without replacing existing text or stealing focus on refresh", () => {
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
    const {focusDatabasePrimary} = exports as typeof import("./primaryFocus");
    const request = {avID: "av", itemID: "row", focusPrimary: true};
    const protyle = {options: {}} as IProtyle;
    focusDatabasePrimary(root, protyle, request);
    assert.equal(focused, 1);
    assert.equal(caret, input.value.length);
    assert.equal(input.value, "Template title");
    focusDatabasePrimary(root, protyle, request);
    assert.equal(focused, 1);
    for (const mode of ["disabled", "publish", "created", "snapshot"]) {
        window.siyuan.isPublish = mode === "publish";
        focusDatabasePrimary(root, {disabled: mode === "disabled", options: {history: {[mode]: "archive"}}} as IProtyle,
            {...request, focusPrimary: true});
    }
    assert.equal(focused, 1);
});

test("opening an item for binding shows primary candidates only once", () => {
    const field = {} as HTMLElement;
    const root = {isConnected: true, querySelector: () => field} as unknown as Element;
    const calls: unknown[][] = [];
    const exports = {} as typeof import("./primaryFocus");
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "primaryFocus.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {exports, window: {siyuan: {}}, require: () => ({
        openAVBindBlock: (...args: unknown[]) => calls.push(args),
    })});
    const request = {avID: "av", itemID: "row", bindPrimary: true};
    const protyle = {options: {}} as IProtyle;
    exports.focusDatabasePrimary(root, protyle, request);
    exports.focusDatabasePrimary(root, protyle, request);
    assert.deepEqual(calls, [[protyle, field]]);
});
