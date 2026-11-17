import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const forms = readFileSync("src/card/flashcardV2Form.ts", "utf8");
const operation = forms.slice(forms.indexOf("export const createFlashcardV2Operation ="),
    forms.indexOf("export const reportFlashcardV2Field =")).replace("export const", "const");
const setup = () => {
    let id = 0;
    const createFlashcardV2Operation = runInNewContext(compile(`${operation}\ncreateFlashcardV2Operation;`), {
        genUUID: () => `operation-${++id}`,
    });
    const exports = {} as {createFlashcardV2AnkiImportState: typeof import("./flashcardV2AnkiImport").createFlashcardV2AnkiImportState};
    runInNewContext(compile(readFileSync("src/card/flashcardV2AnkiImport.ts", "utf8")), {
        exports, require: () => ({createFlashcardV2Operation}),
    });
    return exports.createFlashcardV2AnkiImportState();
};
const file = (name = "deck.apkg") => ({name} as File);

test("import locks on click before readiness and starts only once", () => {
    const state = setup();
    const packageFile = file();
    const attempt = state.begin(packageFile, "notebook");
    assert.equal(state.pending, true);
    assert.equal(state.begin(packageFile, "notebook"), undefined);
    assert.equal(attempt.start(), true);
    assert.equal(attempt.start(), false);
    attempt.finish(true);
    assert.equal(state.pending, false);
});

test("closing before readiness prevents any import request from starting", () => {
    const state = setup();
    const attempt = state.begin(file(), "notebook");
    state.close();
    assert.equal(attempt.start(), false);
    attempt.finish(false);
    assert.equal(state.pending, false);
    assert.equal(state.begin(file(), "notebook"), undefined);
});

test("readiness or import failures retry the same payload with the same identity", () => {
    const state = setup();
    const packageFile = file();
    const first = state.begin(packageFile, "notebook");
    first.finish(false);
    const second = state.begin(packageFile, "notebook");
    assert.equal(second.operationID, first.operationID);
    assert.equal(second.start(), true);
    second.finish(false);
    const third = state.begin(packageFile, "notebook");
    assert.equal(third.operationID, first.operationID);
    third.finish(true);
    assert.notEqual(state.begin(packageFile, "notebook").operationID, first.operationID);
});

test("changing target or package creates a fresh operation without an unbounded cache", () => {
    const state = setup();
    const packageFile = file();
    const ids: string[] = [];
    for (const [current, target] of [[packageFile, "first"], [packageFile, "second"],
        [file(), "second"], [packageFile, "first"]] as Array<[File, string]>) {
        const attempt = state.begin(current, target);
        ids.push(attempt.operationID);
        attempt.finish(false);
    }
    assert.equal(new Set(ids).size, 4);
});

test("late readiness and settlement cannot affect a newer attempt", () => {
    const state = setup();
    const packageFile = file();
    const first = state.begin(packageFile, "first");
    first.finish(false);
    const second = state.begin(packageFile, "second");
    assert.equal(first.start(), false);
    first.finish(true);
    assert.equal(state.pending, true);
    assert.equal(second.start(), true);
});

test("closing an already started import does not pretend the operation was cancelled", () => {
    const state = setup();
    const attempt = state.begin(file(), "notebook");
    assert.equal(attempt.start(), true);
    state.close();
    assert.equal(state.closed, true);
    assert.equal(state.pending, true);
    attempt.finish(true);
    assert.equal(state.pending, false);
});
