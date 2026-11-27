import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadForms = () => {
    let id = 0;
    const messages: string[] = [];
    const exports: {
        createFlashcardV2Operation?: () => (payload: unknown) => {operationID: string, changedAt: number},
        submitFlashcardV2Form?: (element: unknown, save: () => Promise<boolean>) => Promise<void>,
    } = {};
    const source = transpileModule(readFileSync("src/card/flashcardV2Form.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(source, {
        exports,
        window: {siyuan: {languages: {flashcardSaveFailed: "retry"}}},
        console: {error() {}},
        require: (name: string) => name === "../util/genID" ? {genUUID: () => String(++id)} :
            {showMessage: (message: string) => messages.push(message)},
    });
    return {...exports, messages};
};

test("retrying unchanged form data reuses its operation identity and timestamp", () => {
    const operation = loadForms().createFlashcardV2Operation();
    const first = operation({sourceID: "source", groups: ["one", "two"]});
    assert.strictEqual(operation({sourceID: "source", groups: ["one", "two"]}), first);
    const changed = operation({sourceID: "source", groups: ["two", "one"]});
    assert.notEqual(changed.operationID, first.operationID);
});

test("failed saves preserve input, restore disabled controls and permit a retry", async () => {
    const {submitFlashcardV2Form, messages} = loadForms();
    const controls = [{disabled: false, value: "retained"}, {disabled: true, value: "advanced"}];
    const attributes = new Map<string, string>();
    const element = {
        isConnected: true,
        getAttribute: (key: string) => attributes.get(key),
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
        querySelectorAll: () => controls,
    };
    let release: (value: boolean) => void;
    let calls = 0;
    const first = submitFlashcardV2Form(element, () => {
        calls++;
        return new Promise<boolean>((resolve) => release = resolve);
    });
    assert.ok(controls.every((control) => control.disabled));
    await submitFlashcardV2Form(element, async () => { calls++; return true; });
    assert.equal(calls, 1);
    release(false);
    await first;
    assert.deepEqual(controls, [{disabled: false, value: "retained"}, {disabled: true, value: "advanced"}]);
    assert.equal(attributes.has("aria-busy"), false);
    assert.deepEqual(messages, ["retry"]);
    await submitFlashcardV2Form(element, async () => { calls++; return true; });
    assert.equal(calls, 2);
    assert.deepEqual(messages, ["retry"]);
    await submitFlashcardV2Form(element, async () => { calls++; return true; });
    assert.equal(calls, 2);
    assert.ok(controls.every((control) => control.disabled));
});

test("thrown plugin saves restore the form and do not leave an unhandled rejection", async () => {
    const {submitFlashcardV2Form, messages} = loadForms();
    const control = {disabled: false};
    await submitFlashcardV2Form({
        isConnected: true,
        getAttribute: (): string | null => null,
        setAttribute() {},
        removeAttribute() {},
        querySelectorAll: () => [control],
    }, async () => { throw new Error("unavailable"); });
    assert.equal(control.disabled, false);
    assert.deepEqual(messages, ["retry"]);
});
