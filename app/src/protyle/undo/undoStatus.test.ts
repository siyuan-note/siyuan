import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("local undo and redo refresh statistics after applying operations and restoring selection", () => {
    const calls: string[] = [];
    const editor = {};
    const protyle = {wysiwyg: {element: editor, lastHTMLs: {stale: "content"}}, toolbar: {}};
    const dependencies = {
        hideElements() {},
        onTransaction: () => calls.push("apply"),
        restoreUndoFocus: () => calls.push("selection"),
        preventScroll() {},
        scrollCenter() {},
        getBlockSelectionStatusIDs: (element: unknown) => {
            assert.equal(element, editor);
            calls.push("selected IDs");
            return ["selected"];
        },
        countBlockWord: (ids: string[], context: unknown, clearCache: boolean) => {
            assert.deepEqual(ids, ["selected"]);
            assert.equal(context, protyle);
            assert.equal(clearCache, true);
            calls.push("statistics");
        },
    };
    const code = transpileModule(readFileSync("src/protyle/undo/index.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: {Undo?: new () => {renderLocal: (protyle: unknown, operations: unknown[]) => void}} = {};
    runInNewContext(code, {
        exports, require: () => dependencies,
        document: {querySelector: (): null => null},
        getSelection: () => ({rangeCount: 0}),
    });
    const undo = new exports.Undo();
    for (const action of ["insert", "delete"]) {
        calls.length = 0;
        undo.renderLocal(protyle, [{action, id: "block"}]);
        assert.deepEqual(calls, ["apply", "selection", "selected IDs", "statistics"]);
    }
});
