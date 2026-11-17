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

test("waiting text stays outside the empty-state icon rule and actions share one row", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const snippet = source.slice(source.indexOf("const showWaiting ="),
        source.indexOf("const refreshQueueAfterFailedReview ="));
    const script = transpileModule(`${snippet}\nshowWaiting(due);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const lastReview of [undefined, {}]) {
        for (const due of [0, 61000]) {
            const label = {textContent: ""};
            let action = "";
            const front = {
                innerHTML: "",
                querySelector: (selector: string) => selector === "[data-flashcard-wait]" ? label : {
                    insertAdjacentHTML: (position: string, html: string) => {
                        assert.equal(selector, ".card__v2-completion-actions");
                        assert.equal(position, "afterbegin");
                        action = html;
                    },
                },
            };
            runInNewContext(script, {
                due, lastReview, queue: [], completedPending: true, renderPending: false, index: 0,
                requestPending: false, waitingTimer: undefined,
                showCompletion: () => {}, nextCard: () => assert.fail("not due yet"),
                Date: {now: () => 1000},
                dialog: {element: {querySelector: () => front}},
                window: {setInterval: () => 1, siyuan: {languages: {
                    flashcardFinishSession: "Finish", undo: "Undo", loading: "Loading",
                    flashcardWaitingDue: "Next in ${time}",
                }}},
            });
            assert.match(front.innerHTML, /<span data-flashcard-wait><\/span>/);
            assert.doesNotMatch(front.innerHTML, /<div data-flashcard-wait/);
            assert.match(front.innerHTML, /card__v2-completion-actions/);
            assert.match(front.innerHTML, /data-type="finish"/);
            assert.equal(label.textContent, due ? "Next in 1:00" : "Loading");
            assert.equal(action.includes('data-type="undo-review"'), Boolean(lastReview));
        }
    }
});
