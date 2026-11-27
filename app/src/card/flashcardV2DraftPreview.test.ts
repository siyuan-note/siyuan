import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {hasFlashcardAnswer, hideFlashcardAnswer} from "./flashcardMode";

const createPreview = () => {
    const exports: {FlashcardV2DraftPreview?: new () => {
        invalidate: () => void,
        close: () => void,
        run: (request: () => Promise<string>, ready: (value: string) => void,
            connected: () => boolean) => Promise<void>,
    }} = {};
    runInNewContext(transpileModule(readFileSync("src/card/flashcardV2DraftPreview.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, {exports});
    return new exports.FlashcardV2DraftPreview();
};

test("draft previews ignore changed input and permit a fresh retry", async () => {
    const preview = createPreview();
    const results: string[] = [];
    let release: (value: string) => void;
    const pending = preview.run(() => new Promise((resolve) => { release = resolve; }),
        (value) => results.push(value), () => true);
    preview.invalidate();
    release("old");
    await pending;
    assert.deepEqual(results, []);
    await preview.run(async () => "new", (value) => results.push(value), () => true);
    assert.deepEqual(results, ["new"]);
});

test("closing or detaching an editor cannot open a late preview", async () => {
    for (const close of [true, false]) {
        const preview = createPreview();
        let release: (value: string) => void;
        let connected = true;
        let opened = false;
        const pending = preview.run(() => new Promise((resolve) => { release = resolve; }),
            () => { opened = true; }, () => connected);
        if (close) {
            preview.close();
        } else {
            connected = false;
        }
        release("late");
        await pending;
        assert.equal(opened, false);
    }
});

test("concurrent previews coalesce and failures release the pending guard", async () => {
    const preview = createPreview();
    let reject: (error: Error) => void;
    let calls = 0;
    const pending = preview.run(() => {
        calls++;
        return new Promise((_, fail) => { reject = fail; });
    }, () => {}, () => true);
    await preview.run(async () => { calls++; return "duplicate"; }, () => {}, () => true);
    assert.equal(calls, 1);
    reject(new Error("offline"));
    await assert.rejects(pending, /offline/);
    await preview.run(async () => { calls++; return "retry"; }, () => {}, () => true);
    assert.equal(calls, 2);
});

test("editor preview calls only its read endpoint and strips mutation metadata", async () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("                    if (preview) {\n");
    assert.notEqual(start, -1);
    const branch = source.slice(start, source.indexOf("                    const operation = operationFor(payload);", start));
    const requests: Array<{url: string, payload: Record<string, unknown>}> = [];
    const opened: unknown[] = [];
    const state = {
        preview: true,
        previewButton: {dataset: {} as Record<string, string>, disabled: false},
        payload: {sourceID: "source", mode: "typedAnswer", blockIDs: ["a", "b"],
            expectedRevisionID: "persisted-revision", reviewSetIDs: ["set"]},
        draftPreview: createPreview(),
        dialog: {element: {isConnected: true}},
        readFlashcardV2RenderModel: (model: unknown) => model,
        fetchPost: async (url: string, payload: Record<string, unknown>, callback: (response: unknown) => void) => {
            requests.push({url, payload});
            callback({data: {models: [{card: {id: "preview-card"}}], doms: {a: "question", b: "answer"}}});
        },
        openFlashcardV2Preview: (...args: unknown[]) => opened.push(args),
        updateConfirm: () => {},
        console,
    };
    runInNewContext(transpileModule(`(() => {${branch}})()`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, state);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/flashcard/previewAdvancedSource");
    assert.equal(Object.hasOwn(requests[0].payload, "expectedRevisionID"), false);
    assert.equal(Object.hasOwn(requests[0].payload, "reviewSetIDs"), false);
    assert.equal(Object.hasOwn(requests[0].payload, "operationID"), false);
    assert.equal(opened.length, 1);
    assert.equal(state.previewButton.dataset.busy, undefined);
});

test("preview network failures notify only the current editor and remain retryable", async () => {
    const source = readFileSync("src/card/flashcardV2.ts", "utf8").replace(/\r\n/g, "\n");
    const start = source.indexOf("                    if (preview) {\n");
    const branch = source.slice(start, source.indexOf("                    const operation = operationFor(payload);", start));
    for (const stale of [false, true]) {
        const preview = createPreview();
        const messages: string[] = [];
        let fail: () => void;
        let resolve: () => void;
        const state = {
            preview: true, previewButton: {dataset: {} as Record<string, string>, disabled: false},
            payload: {sourceID: "source", mode: "typedAnswer", blockIDs: ["a", "b"]},
            draftPreview: preview, dialog: {element: {isConnected: true}},
            fetchPost: (...args: unknown[]) => {
                fail = args[4] as () => void;
                return new Promise<void>(ready => { resolve = ready; });
            },
            showMessage: (message: string) => messages.push(message),
            window: {siyuan: {languages: {flashcardLoadFailed: "Please retry"}}},
            updateConfirm: () => {}, console,
        };
        runInNewContext(transpileModule(`(() => {${branch}})()`, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, state);
        if (stale) {
            preview.invalidate();
        }
        fail();
        resolve();
        await new Promise(ready => setImmediate(ready));
        assert.deepEqual(messages, stale ? [] : ["Please retry"]);
        assert.equal(state.previewButton.dataset.busy, undefined);
        let retried = false;
        await preview.run(async () => "retry", () => { retried = true; }, () => true);
        assert.equal(retried, true);
    }
});

test("ordered and grouped cloze previews leave mark visibility to their reveal controller", () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const start = source.indexOf("const flashcardConfig = window.siyuan.config.flashcard;");
    const end = source.indexOf("if (shouldShowFlashcardRatingsImmediately(", start);
    assert.ok(start > 0 && end > start);
    const script = transpileModule(source.slice(start, end), {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    for (const [sourceType, hasController, legacyMask] of [
        ["ordered", true, false], ["cloze", true, false], ["cloze", false, true], ["block", false, true],
    ]) {
        const classes = new Set<string>();
        runInNewContext(script, {
            window: {siyuan: {config: {flashcard: {mark: true}}}},
            model: {source: {sourceType}}, revealController: hasController ? {} : undefined,
            hasFlashcardAnswer, hideFlashcardAnswer,
            frontElement: {querySelector: () => ({})},
            contentElement: {classList: {add: (name: string) => classes.add(name),
                remove: (...names: string[]) => names.forEach(name => classes.delete(name))}},
        });
        assert.equal(classes.has("card__block--hidemark"), legacyMask, String(sourceType));
    }
});

test("draft renderer consumes its snapshot without model, block, context, or session requests", async () => {
    const source = readFileSync("src/card/flashcardV2Session.ts", "utf8");
    const start = source.indexOf("const renderFlashcardV2Card =");
    const body = source.slice(start, source.indexOf("const renderSessionCard =", start));
    const node = () => ({
        innerHTML: "", className: "", textContent: "",
        classList: {add() {}, remove() {}},
        querySelector: (): {focus: () => void} => node(),
        querySelectorAll: () => [] as never[],
        appendChild() {}, insertAdjacentHTML() {}, remove() {}, focus() {},
    });
    const model = {card: {id: "draft"}, source: {sourceType: "typed-answer"}, schema: {},
        template: {frontSpec: {}, backSpec: {}, answerMode: "typed"},
        references: [{entityType: "block", entityID: "a", role: "front", sort: 0}]};
    const before = JSON.stringify(model);
    const requests: string[] = [];
    const rendered: unknown[] = [];
    const state = {
        dialog: {element: node()}, current: {cardID: "draft"},
        draft: {model, doms: {a: "snapshot"}},
        done: (value: unknown) => rendered.push(value),
        unavailable: () => { throw new Error("Unexpected unavailable"); },
        setReviewActionsEnabled() {}, setActionsVisible() {},
        createFlashcardV2TemplateStyle: (): undefined => undefined,
        selectReferences: (references: unknown[]) => references,
        renderFlashcardV2AnkiTemplate: (): undefined => undefined,
        renderFlashcardV2Choice: (): undefined => undefined,
        renderFlashcardV2MultiLine: (): undefined => undefined,
        referenceHTML: (_references: unknown[], doms: {a: string}) => {
            assert.equal(doms.a, "snapshot");
            return doms.a;
        },
        processRender() {}, highlightRender() {},
        prepareFlashcardV2Reveal: (): undefined => undefined,
        prepareFlashcardV2TypedAnswers: (): undefined => undefined,
        prepareFlashcardV2Choice: (): undefined => undefined,
        prepareFlashcardV2Playback: () => ({activate: () => requests.push("autoplay")}),
        hasFlashcardAnswer: () => false,
        shouldShowFlashcardRatingsImmediately: () => false,
        renderFlashcardV2Context: () => requests.push("context"),
        fetchPost: () => { requests.push("model"); return Promise.resolve(); },
        loadFlashcardV2DOMs: () => { requests.push("blocks"); return Promise.resolve(); },
        window: {siyuan: {config: {flashcard: {}}}},
        performance, structuredClone,
    };
    runInNewContext(transpileModule(`${body}\nrenderFlashcardV2Card(dialog, current, () => true, done, unavailable, true, draft);`, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText, state);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(requests, []);
    assert.equal(rendered.length, 1);
    assert.equal(JSON.stringify(model), before);
});
