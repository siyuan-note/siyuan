import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/dialog/mobileAnchoredInput.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const setup = () => {
    let observe: () => void;
    const state: {dialog?: any} = {};
    const input = {value: "", isConnected: true, listeners: {} as Record<string, (event: any) => void>,
        addEventListener(name: string, callback: (event: any) => void) { input.listeners[name] = callback; }};
    class MockDialog {
        closed = false;
        focused = 0;
        element = {querySelector: (selector: string) => selector === "textarea" ? input :
            {addEventListener() {}}, contains: (target: unknown) => target === input};
        constructor(public options: any) { state.dialog = this; }
        requestClose(reason: string) {
            if (this.options.mobileSheet.beforeClose(reason)) {
                this.closed = true;
                this.options.destroyCallback();
            }
            return Promise.resolve(this.closed);
        }
        invalidate() { this.closed = true; this.options.destroyCallback(); }
        focusWhenReady() { this.focused++; }
    }
    const exports: any = {};
    runInNewContext(source, {exports,
        require: () => ({MobileDialog: MockDialog, escapeAttr: (value: string) => value}),
        document: {body: {}}, window: {siyuan: {languages: {cancel: "Cancel", confirm: "Confirm"}}},
        MutationObserver: class {constructor(callback: () => void) { observe = callback; } observe() {} disconnect() {}},
    });
    let valid = true;
    let fail = false;
    const saved: string[] = [];
    let unregister = 0;
    const sheet = exports.openMobileAnchoredInput({label: "Image title", value: "Original", anchor: {},
        isValid: () => valid, save: (value: string) => {
            if (fail) throw Error("save failed");
            saved.push(value);
        }}, () => unregister++);
    return {sheet, input, saved, dialog: state.dialog, invalid: () => { valid = false; observe(); },
        fail: () => { fail = true; }, count: () => unregister};
};
test("image-title mobile flush saves synchronously before owner teardown and unregisters once", () => {
    const f = setup();
    f.input.value = "Edited";
    f.sheet.close(true);
    assert.deepEqual(f.saved, ["Edited"]);
    assert.equal(f.input.value, "");
    assert.equal(f.count(), 1);
});
test("Escape cancels whereas Back/passive close retains the original save convention", async () => {
    for (const reason of ["escape", "cancel", "back", "scrim"]) {
        const f = setup();
        f.input.value = "Edited";
        await f.dialog.requestClose(reason);
        assert.deepEqual(f.saved, reason === "escape" || reason === "cancel" ? [] : ["Edited"]);
    }
});
test("source invalidation clears plaintext without saving; failed save keeps draft", () => {
    const f = setup();
    f.input.value = "Secret";
    f.invalid();
    assert.equal(f.input.value, "");
    assert.deepEqual(f.saved, []);
    assert.equal(f.dialog.closed, true);
    const failed = setup();
    failed.fail();
    failed.input.value = "Retry";
    assert.throws(() => failed.sheet.close(true), /save failed/);
    assert.equal(failed.input.value, "Retry");
    assert.equal(failed.dialog.closed, false);
});
test("IME Enter does not submit; blur into internal controls does not preempt cancellation", () => {
    const f = setup();
    f.input.listeners.keydown({key: "Enter", isComposing: true, stopPropagation() {}});
    f.input.listeners.blur({relatedTarget: f.input});
    assert.deepEqual(f.saved, []);
    assert.equal(f.dialog.closed, false);
    f.input.listeners.blur({relatedTarget: null});
    assert.deepEqual(f.saved, ["Original"]);
});
