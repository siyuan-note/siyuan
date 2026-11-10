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
        className = "";
        id = "";
        textContent = "";
        inserted: Control[] = [];
        listeners: Record<string, (event?: any) => void> = {};
        addEventListener(name: string, callback: (event?: any) => void) { this.listeners[name] = callback; }
        click() { this.listeners.click?.(); }
        focus() { events.push("early-focus"); }
        before(...controls: Control[]) { this.inserted.push(...controls); }
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
        Constants: {}, createInputDialog: (options: any, DialogConstructor: typeof MockDialog) => {
            delegated = options;
            return new DialogConstructor(options);
        },
        confirmDialog: (...args: any[]) => { delegated = args; return new MockDialog({}); }};
    const load = (file: string) => {
        const exports: any = {};
        runInNewContext(transpileModule(readFileSync("src/dialog/" + file + ".ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: () => dependencies, HTMLInputElement: Control,
            document: {activeElement: undefined, body: {}, createElement: () => new Control()},
            window: {siyuan: {languages: {confirm: "Confirm", cancel: "Cancel"}}}, console});
        return exports;
    };
    return {...load("mobileInputDialog"), ...load("mobileConfirmDialog"), events, pending, delegated: () => delegated};
};

test("compact input actions retain touch buttons without changing the default action layout", () => {
    const f = setup();
    const options = {title: "Rename", value: "Draft", onConfirm() {}};
    const compact = f.mobileInputDialog({...options, compactActions: true});
    assert.match(compact.options.content, /mobile-sheet-action-group--compact/);
    assert.equal((compact.options.content.match(/b3-button--touch/g) || []).length, 2);
    assert.doesNotMatch(f.mobileInputDialog(options).options.content, /mobile-sheet-action-group--compact/);
});

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

test("mobile confirmation groups touch actions and keeps danger and extra action semantics", () => {
    const f = setup();
    const dialog = f.mobileConfirmDialog("Title", "Text");
    assert.match(dialog.options.content, /b3-dialog__action mobile-sheet-action-bar/);
    assert.match(dialog.options.content, /mobile-sheet-action-group/);
    assert.match(dialog.options.content, /b3-button--touch b3-button--wrap b3-button--cancel b3-button--secondary/);
    assert.doesNotMatch(dialog.options.content, /b3-button--text|fn__space|group--stacked/);
    let extra = 0;
    const danger = f.mobileConfirmDialog("Title", "Text", undefined, undefined, true,
        {label: "Extra", callback: () => extra++});
    assert.match(danger.options.content, /mobile-sheet-action-group--stacked/);
    assert.match(danger.options.content, /b3-button--wrap b3-button--remove/);
    assert.equal(danger.confirm.inserted.length, 1);
    assert.equal(danger.confirm.inserted[0].textContent, "Extra");
    assert.match(danger.confirm.inserted[0].className, /b3-button--touch b3-button--wrap/);
    danger.listeners.click({target: {id: "extraDialogConfirmBtn"}, detail: 0});
    assert.equal(extra, 1);
    assert.equal(f.events.at(-1), "destroy");
});

test("mobile input touch actions preserve custom ordering and stack three or more actions", () => {
    const f = setup();
    const basic = f.mobileInputDialog({title: "Name", value: "", onConfirm() {}});
    assert.match(basic.options.content, /b3-dialog__action mobile-sheet-action-bar/);
    assert.doesNotMatch(basic.options.content, /group--stacked|fn__space|b3-button--text/);
    const dialog = f.mobileInputDialog({title: "Name", value: "", onConfirm() {}, actions: [
        {text: "First", position: "beforeCancel", onClick() {}},
        {text: "Second", danger: true, onClick() {}},
        {text: "Last", position: "afterConfirm", onClick() {}},
    ]});
    const html = dialog.options.content;
    assert.match(html, /mobile-sheet-action-group--stacked/);
    assert.match(html, /b3-button--touch b3-button--wrap b3-button--remove/);
    const markers = ['data-input-action="0"', "data-input-cancel", 'data-input-action="1"', "data-input-confirm", 'data-input-action="2"'];
    for (let i = 1; i < markers.length; i++) assert.ok(html.indexOf(markers[i - 1]) < html.indexOf(markers[i]));
    assert.equal((html.match(/b3-button--touch/g) || []).length, 5);
});
