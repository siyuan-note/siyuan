import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("document title keyboard keeps inline styles and rejects configured block transformations", () => {
    const source = transpileModule(readFileSync(join(__dirname, "documentTitleKeys.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const moduleExports: {isDocumentTitleBlockHotkey?: (event: {key: string}) => boolean} = {};
    runInNewContext(source, {
        exports: moduleExports,
        window: {siyuan: {config: {keymap: {editor: {
            heading: {heading1: "heading"}, list: {indent: "indent"}, table: {insertRow: "row"},
            insert: {bold: "bold", "inline-code": "inline-code", "inline-math": "inline-math", ref: "ref", memo: "memo",
                code: "block-code", table: "table", "callout-note": "note", lastUsed: "last-used"},
            general: {insertBefore: "insert-before", moveToUp: "move", newNameFile: "new-doc", selectAll: "select"},
        }}}}},
        require: () => ({matchHotKey: (key: string, event: {key: string}) => key === event.key}),
    });
    for (const key of ["heading", "indent", "row", "block-code", "table", "note", "last-used", "insert-before", "move", "new-doc"]) {
        assert.equal(moduleExports.isDocumentTitleBlockHotkey({key}), true, key);
    }
    for (const key of ["bold", "inline-code", "inline-math", "ref", "memo", "select", "a"]) {
        assert.equal(moduleExports.isDocumentTitleBlockHotkey({key}), false, key);
    }
});
