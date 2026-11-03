import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = (mobile = true) => {
    const events: string[] = [];
    const pending: Promise<boolean>[] = [];
    let delegated: any;
    class Control {
        value = "";
        listeners: Record<string, (event?: any) => void> = {};
        addEventListener(name: string, callback: (event?: any) => void) { this.listeners[name] = callback; }
        click() { this.listeners.click?.(); }
        focus() { events.push("early-focus"); }
    }
    class MockDialog {
        input = new Control();
        cancel = new Control();
        confirm = new Control();
        element = {querySelector: (selector: string) => selector.includes("cancel") ? this.cancel :
            selector.includes("input]") ? this.input : this.confirm,
        querySelectorAll: (): any[] => [], setAttribute() {},
        addEventListener: (name: string, callback: (event: any) => void) => { this.listeners[name] = callback; }};
        listeners: Record<string, (event: any) => void> = {};
        constructor(public options: any) {}
        focusWhenReady() { events.push("deferred-focus"); }
        bindInput() {}
        requestClose(reason: string) {
            events.push(reason);
            this.options.destroyCallback?.();
            return Promise.resolve(true);
        }
        destroy() { void this.requestClose("destroy"); }
        runPending(task: () => Promise<boolean>) {
            const promise = task().then(success => {
                if (success) void this.requestClose("confirm");
                return success;
            });
            pending.push(promise);
            return promise;
        }
    }
    const dependencies = {MobileDialog: MockDialog, isMobile: () => mobile, escapeHtml: (value: string) => value,
        Constants: {}, openInputDialog: (options: any) => { delegated = options; return new MockDialog(options); },
        confirmDialog: (...args: any[]) => { delegated = args; return new MockDialog({}); }};
    const load = (file: string) => {
        const exports: any = {};
        runInNewContext(transpileModule(readFileSync("src/dialog/" + file + ".ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: () => dependencies, HTMLInputElement: Control,
            document: {activeElement: undefined, body: {}},
            window: {siyuan: {languages: {confirm: "Confirm", cancel: "Cancel"}}}, console});
        return exports;
    };
    return {...load("mobileInputDialog"), ...load("mobileConfirmDialog"), events, pending, delegated: () => delegated};
};

test("mobile input wrapper defers initial focus and only successful awaited confirmation closes", async () => {
    const f = setup();
    let success = false;
    const dialog = f.mobileInputDialog({title: "Rename", value: "Draft", awaitConfirm: true,
        onConfirm: async (value: string) => { assert.equal(value, "Draft"); return success; }});
    assert.deepEqual(f.events, ["deferred-focus"]);
    dialog.confirm.click();
    assert.equal(await f.pending.pop(), false);
    assert.equal(f.events.includes("confirm"), false);
    success = true;
    dialog.confirm.click();
    assert.equal(await f.pending.pop(), true);
    assert.equal(f.events.filter((item: string) => item === "confirm").length, 1);
});
test("desktop input delegation interprets explicit true success without changing legacy void callbacks", async () => {
    const f = setup(false);
    let success = false;
    const dialog = f.mobileInputDialog({title: "Rename", value: "", awaitConfirm: true, onConfirm: async () => success});
    f.delegated().onConfirm("", dialog);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, []);
    success = true;
    f.delegated().onConfirm("", dialog);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, ["destroy"]);
});
test("mobile confirmation failure retains cancellation, success does not invoke cancel", async () => {
    const f = setup();
    let cancelled = 0;
    const dialog = f.mobileConfirmDialog("Title", "Text", async () => false, () => cancelled++, false,
        undefined, undefined, {awaitConfirm: true});
    const event = {target: {id: "confirmDialogConfirmBtn"}, detail: 0};
    dialog.listeners.click(event);
    assert.equal(await f.pending.pop(), false);
    assert.equal(cancelled, 0);
    await dialog.requestClose("cancel");
    await dialog.requestClose("cancel");
    assert.equal(cancelled, 1);
    const accepted = f.mobileConfirmDialog("Title", "Text", async () => true, () => cancelled++, false,
        undefined, undefined, {awaitConfirm: true});
    accepted.listeners.click(event);
    assert.equal(await f.pending.pop(), true);
    assert.equal(cancelled, 1);
});
test("desktop confirmation preserves the legacy seven arguments", () => {
    const f = setup(false);
    const confirm = () => {};
    const cancel = () => {};
    const extra = {label: "Extra", callback() {}};
    f.mobileConfirmDialog("Title", "Text", confirm, cancel, true, extra, "Delete", {awaitConfirm: true});
    assert.deepEqual(f.delegated(), ["Title", "Text", confirm, cancel, true, extra, "Delete"]);
});

test("mobile confirmation distinguishes an Escape dispatch from explicit cancellation", () => {
    const f = setup();
    const escaped = f.mobileConfirmDialog("Title", "Text");
    escaped.listeners.click({target: {id: ""}, detail: "Escape"});
    assert.equal(f.events.at(-1), "escape");
    const cancelled = f.mobileConfirmDialog("Title", "Text");
    cancelled.listeners.click({target: {id: "cancelDialogConfirmBtn"}, detail: 0});
    assert.equal(f.events.at(-1), "cancel");
});
