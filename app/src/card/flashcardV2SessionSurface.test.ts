import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadSurface = (globals: Record<string, unknown>) => {
    const path = "src/card/flashcardV2Session.ts";
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "createSessionSurface"));
    assert.ok(declaration);
    const compiled = transpileModule(`${declaration.getText(source)}\nexports.create = createSessionSurface;`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const exports: any = {};
    runInNewContext(compiled, {exports, queueMicrotask, ...globals});
    return exports.create;
};

test("another practice round waits for the dialog closing lifecycle to finish", async () => {
    const calls: string[] = [];
    let finishClosing: () => void;
    const create = loadSurface({Dialog: class {
        element = {};
        constructor(options: {destroyCallback: () => void}) {
            finishClosing = () => {
                options.destroyCallback();
                calls.push("removed-from-dialogs");
            };
        }
        destroy() { calls.push("closing"); }
    }});
    const surface = create({destroyCallback: () => calls.push("cleanup")});
    surface.dispose(() => calls.push("start-practice"));
    assert.deepEqual(calls, ["closing"]);
    finishClosing();
    assert.deepEqual(calls, ["closing", "cleanup", "removed-from-dialogs"]);
    await Promise.resolve();
    assert.deepEqual(calls, ["closing", "cleanup", "removed-from-dialogs", "start-practice"]);
});

test("practice replaces a mounted session without closing its tab or leaving abort listeners", () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const create = loadSurface({document: {
        createElement: () => ({style: {}, remove: () => calls.push("remove-surface")}),
    }});
    const mount = {
        element: {replaceChildren: () => calls.push("mount")},
        signal: controller.signal,
        close: () => { calls.push("close-tab"); controller.abort(); },
    };
    const first = create({content: "first", destroyCallback: () => calls.push("cleanup-first")}, mount);
    let second: ReturnType<typeof create>;
    first.dispose(() => {
        second = create({content: "second", destroyCallback: () => calls.push("cleanup-second")}, mount);
    });
    assert.deepEqual(calls, ["mount", "cleanup-first", "remove-surface", "mount"]);
    assert.equal(controller.signal.aborted, false);
    second.destroy();
    assert.deepEqual(calls, ["mount", "cleanup-first", "remove-surface", "mount", "close-tab",
        "cleanup-second", "remove-surface"]);
});
