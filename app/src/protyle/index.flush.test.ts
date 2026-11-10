import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync(join(__dirname, "index.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

test("editor invalidation stops pending save handoffs at each asynchronous boundary", async () => {
    for (const boundary of ["before", "title", "body", "queue"]) {
        let release: () => void;
        const pending = new Promise<void>(resolve => { release = resolve; });
        const calls: string[] = [];
        const step = (name: string) => {
            calls.push(name);
            return boundary === name ? pending : Promise.resolve();
        };
        const exports: {Protyle?: {prototype: {flushPendingTransactions: () => Promise<void>}}} = {};
        runInNewContext(source, {exports, require: () => ({waitForPendingTransactions: () => step("queue")})});
        const editor = Object.assign(Object.create(exports.Protyle.prototype), {
            destroyed: boundary === "before",
            protyle: {title: {flushPendingInput: () => step("title")},
                wysiwyg: {flushPendingInput: () => step("body")}},
        });
        const flush = editor.flushPendingTransactions();
        await new Promise<void>(resolve => setImmediate(resolve));
        const expected = boundary === "before" ? [] : ["title", "body", "queue"].slice(0,
            ["title", "body", "queue"].indexOf(boundary) + 1);
        assert.deepEqual(calls, expected);
        editor.destroyed = true;
        release();
        await flush;
        assert.deepEqual(calls, expected, `no further save may start after invalidation at ${boundary}`);
    }
});
