import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {checkFlashcardV2Answer, snapshotFlashcardV2AnswerResult} from "./flashcardV2Plugin";

test("answer checking preserves synchronous results and snapshots", () => {
    const result = {correct: false, answers: ["one"]};
    const checked = checkFlashcardV2Answer(() => result, () => assert.fail("unexpected failure"));
    assert.equal(checked, result);
    const snapshot = snapshotFlashcardV2AnswerResult(checked);
    result.answers.push("two");
    assert.deepEqual(snapshot, {correct: false, answers: ["one"]});
    assert.equal(checkFlashcardV2Answer(() => undefined, () => assert.fail()), undefined);
});

test("throws and throwing then getters return no answer and report failure", () => {
    let failures = 0;
    for (const check of [() => { throw new Error("check failed"); }, () => ({
        get then() { throw new Error("getter failed"); },
    })]) {
        assert.equal(checkFlashcardV2Answer(check, () => failures++), undefined);
    }
    assert.equal(failures, 2);
});

test("unsupported promises and thenables are ignored and their rejections are handled", async () => {
    let failures = 0;
    for (const value of [Promise.resolve({correct: true}), Promise.reject(new Error("async failed")), {
        then(_resolve: (value: unknown) => void, reject: (error: Error) => void) {
            reject(new Error("thenable failed"));
        },
    }]) {
        const checked = checkFlashcardV2Answer(() => value, () => failures++);
        assert.equal(checked, undefined);
        assert.equal(snapshotFlashcardV2AnswerResult(checked), undefined);
    }
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failures, 3);
});

const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
const execute = (code: string, globals: Record<string, unknown>) => runInNewContext(transpileModule(code, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText, globals);

test("actual review reveal still exposes answer and manual ratings after checker failure without reviewing", () => {
    const start = source.indexOf("const reveal = () => {");
    const end = source.indexOf("const updateManagedQueueCards", start);
    assert.ok(start > 0 && end > start);
    const calls: string[] = [];
    const globals: Record<string, unknown> = {
        checkFlashcardV2Answer,
        canUseReviewActions: () => true,
        dialog: {element: {querySelector: () => ({classList: {remove: () => calls.push("answer-visible")}})}},
        revealController: undefined,
        pluginAnswerController: {check: () => { throw new Error("plugin failed"); }},
        choiceController: undefined, typedAnswerController: undefined,
        showMessage: () => calls.push("warning"),
        window: {siyuan: {languages: {flashcardAnswerCheckFailed: "failed"}}},
        showFlashcardAnswer: () => calls.push("flipped"),
        playbackController: undefined,
        emitFlashcardV2Lifecycle: () => calls.push("revealed-event"),
        app: {}, currentModel: undefined, sessionID: "session", reviewSetID: "deck", options: {},
        outline: {reveal: (complete: boolean) => assert.equal(complete, true)},
        setActionsVisible: (_dialog: unknown, complete: boolean) => { assert.equal(complete, true); calls.push("manual-ratings"); },
        fetchPost: () => assert.fail("reveal must not submit a review"),
        answerResult: {correct: true},
    };
    execute(`${source.slice(start, end)}; reveal();`, globals);
    assert.equal(globals.answerResult, undefined);
    assert.deepEqual(calls, ["warning", "flipped", "answer-visible", "revealed-event", "manual-ratings"]);
});

test("actual preview show still exposes answer after checker failure without reviewing", () => {
    const start = source.indexOf('if (button.dataset.type === "show" && rendered)');
    const end = source.indexOf('} else if (["previous", "next", "reset", "retry"]', start);
    assert.ok(start > 0 && end > start);
    const calls: string[] = [];
    const show = {disabled: false};
    execute(`${source.slice(start, end)}}`, {
        button: {dataset: {type: "show"}},
        rendered: {pluginAnswerController: {check: () => { throw new Error("preview failed"); }}},
        checkFlashcardV2Answer,
        showMessage: () => calls.push("warning"),
        window: {siyuan: {languages: {flashcardAnswerCheckFailed: "failed"}}},
        dialog: {element: {querySelector: () => ({classList: {remove: () => calls.push("answer-visible")}})}},
        showFlashcardAnswer: () => calls.push("flipped"), show,
        fetchPost: () => assert.fail("preview must not submit a review"),
    });
    assert.equal(show.disabled, true);
    assert.deepEqual(calls, ["warning", "flipped", "answer-visible"]);
});
