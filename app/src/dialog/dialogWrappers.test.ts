import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = (mobile = true) => {
    const events: string[] = [];
    const pending: Promise<boolean>[] = [];
    const messages: string[] = [];
    const pendingOptions: any[] = [];
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
        select() {}
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
            if (this.options.beforeClose?.() === false) return Promise.resolve(false);
            events.push(reason);
            this.options.destroyCallback?.();
            return Promise.resolve(true);
        }
        destroy() { void this.requestClose("destroy"); }
        runPending(task: () => Promise<boolean>, options?: any) {
            pendingOptions.push(options);
            const promise = task().then(success => {
                if (success) void this.requestClose("confirm");
                return success;
            });
            pending.push(promise);
            return promise;
        }
    }
    const dependencies = {AdaptiveDialog: MockDialog, Dialog: MockDialog, isMobile: () => mobile,
        escapeHtml: (value: string) => value,
        showMessage: (message: string) => messages.push(message),
        Constants: {}};
    const load = (file: string) => {
        const exports: any = {};
        runInNewContext(transpileModule(readFileSync("src/dialog/" + file + ".ts", "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: () => dependencies, HTMLInputElement: Control,
            document: {activeElement: undefined, body: {}, createElement: () => new Control()},
            window: {siyuan: {languages: {confirm: "Confirm", cancel: "Cancel", confirmActionFailed: "Operation failed"}}},
            console: {...console, error() {}}});
        return exports;
    };
    return {...load("inputDialog"), ...load("confirmDialog"), events, pending, messages, pendingOptions};
};

test("input actions use the same full-width touch group as confirmations", () => {
    const f = setup();
    const options = {title: "Rename", value: "Draft", onConfirm() {}};
    const dialog = f.openInputDialog(options);
    assert.match(dialog.options.content, /class="mobile-sheet-action-group"/);
    assert.equal((dialog.options.content.match(/b3-button--touch/g) || []).length, 2);
});

test("mobile input wrapper defers initial focus and only successful awaited confirmation closes", async () => {
    const f = setup();
    let success = false;
    const dialog = f.openInputDialog({title: "Rename", value: "Draft", awaitConfirm: true,
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
test("desktop input confirmation closes only after an explicit true result", async () => {
    const f = setup(false);
    let success = false;
    const destroyed = () => f.events.filter((item: string) => item === "destroy");
    const dialog = f.openInputDialog({title: "Rename", value: "", awaitConfirm: true, onConfirm: async () => success});
    dialog.confirm.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(destroyed(), []);
    success = true;
    dialog.confirm.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(destroyed(), ["destroy"]);
});
test("mobile confirmation failure retains cancellation, success does not invoke cancel", async () => {
    const f = setup();
    let cancelled = 0;
    const dialog = f.confirmDialog({title: "Title", text: "Text", confirm: async () => false,
        cancel: () => cancelled++});
    const event = {target: {id: "confirmDialogConfirmBtn"}, detail: 0};
    dialog.listeners.click(event);
    assert.equal(await f.pending.pop(), false);
    assert.equal(cancelled, 0);
    await dialog.requestClose("cancel");
    await dialog.requestClose("cancel");
    assert.equal(cancelled, 1);
    const accepted = f.confirmDialog({title: "Title", text: "Text", confirm: async () => true,
        cancel: () => cancelled++});
    accepted.listeners.click(event);
    assert.equal(await f.pending.pop(), true);
    assert.equal(cancelled, 1);
});
test("desktop confirmation waits for the confirm handler and keeps the dialog on failure", async () => {
    const f = setup(false);
    let attempts = 0;
    const dialog = f.confirmDialog({title: "Title", text: "Text", confirm: async () => ++attempts > 1});
    dialog.listeners.click({target: {id: "confirmDialogConfirmBtn"}, detail: 0});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.events.includes("destroy"), false);
    dialog.listeners.click({target: {id: "confirmDialogConfirmBtn"}, detail: 0});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.events.filter((item: string) => item === "destroy").length, 1);
});

test("desktop confirmation blocks cancel and dismissal during pending work", async () => {
    const f = setup(false);
    let finish: (success: boolean) => void;
    let attempts = 0;
    let cancelled = 0;
    const dialog = f.confirmDialog({title: "Title", text: "Text", confirm: () => {
        attempts++;
        return new Promise<boolean>(resolve => { finish = resolve; });
    }, cancel: () => cancelled++});
    const click = (id: string, detail: number | string = 0) => dialog.listeners.click({target: {id}, detail});
    click("confirmDialogConfirmBtn");
    click("confirmDialogConfirmBtn");
    click("cancelDialogConfirmBtn");
    click("", "Escape");
    dialog.destroy();
    assert.equal(attempts, 1);
    assert.equal(cancelled, 0);
    assert.equal(f.events.includes("destroy"), false);
    finish(false);
    await new Promise(resolve => setImmediate(resolve));
    click("cancelDialogConfirmBtn");
    assert.equal(cancelled, 1);
    assert.equal(f.events.filter((item: string) => item === "destroy").length, 1);
});

test("plugin confirmation with empty content waits for the explicitly confirmed action", async () => {
    const f = setup(false);
    let complete: () => void;
    let calls = 0;
    const dialog = f.createDesktopConfirmDialog({title: "", text: "",
        confirm: () => {
            calls++;
            return new Promise<void>(resolve => { complete = resolve; });
        },
        cancel: () => assert.fail("successful confirmation must not cancel"),
    });
    assert.equal(calls, 0);
    assert.deepEqual(f.events, ["early-focus"]);
    dialog.listeners.click({target: {id: "confirmDialogConfirmBtn"}, detail: 0});
    assert.equal(calls, 1);
    assert.deepEqual(f.events, ["early-focus"]);
    complete();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.events, ["early-focus", "destroy"]);
});

test("desktop confirmation reports a neutral failure when the handler throws", async () => {
    const f = setup(false);
    const dialog = f.confirmDialog({title: "Title", text: "Text", confirm: async () => {
        throw new Error("boom");
    }});
    dialog.listeners.click({target: {id: "confirmDialogConfirmBtn"}, detail: 0});
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.messages, ["Operation failed"]);
    assert.equal(f.events.includes("destroy"), false);
});

test("mobile confirmation forwards the neutral failure message to the pending lock", async () => {
    const f = setup();
    const dialog = f.confirmDialog({title: "Title", text: "Text", confirm: async () => false});
    dialog.listeners.click({target: {id: "confirmDialogConfirmBtn"}, detail: 0});
    await f.pending.pop();
    assert.equal(f.pendingOptions[0].failureMessage, "Operation failed");
});

test("desktop confirmation renders its own labels", () => {
    const f = setup(false);
    const dialog = f.confirmDialog({title: "Title", text: "Text", cancelLabel: "Later", confirmLabel: "Delete",
        isDelete: true});
    assert.match(dialog.options.content, />Later</);
    assert.match(dialog.options.content, />Delete</);
    assert.match(dialog.options.content, /b3-button--remove/);
    assert.doesNotMatch(dialog.options.content, /b3-button--touch|mobile-sheet-action-bar/);
});

test("mobile confirmation renders the cancel label without affecting the default", () => {
    const f = setup();
    assert.match(f.confirmDialog({title: "Title", text: "Text"}).options.content, />Cancel</);
    assert.match(f.confirmDialog({title: "Title", text: "Text", cancelLabel: "Later"}).options.content, />Later</);
});

test("mobile confirmation distinguishes an Escape dispatch from explicit cancellation", () => {
    const f = setup();
    const escaped = f.confirmDialog({title: "Title", text: "Text"});
    escaped.listeners.click({target: {id: ""}, detail: "Escape"});
    assert.equal(f.events.at(-1), "escape");
    const cancelled = f.confirmDialog({title: "Title", text: "Text"});
    cancelled.listeners.click({target: {id: "cancelDialogConfirmBtn"}, detail: 0});
    assert.equal(f.events.at(-1), "cancel");
});

test("mobile confirmation groups touch actions and keeps danger and extra action semantics", () => {
    const f = setup();
    const dialog = f.confirmDialog({title: "Title", text: "Text"});
    assert.match(dialog.options.content, /b3-dialog__action mobile-sheet-action-bar/);
    assert.match(dialog.options.content, /mobile-sheet-action-group/);
    assert.match(dialog.options.content, /b3-button--touch b3-button--wrap b3-button--cancel b3-button--secondary/);
    assert.doesNotMatch(dialog.options.content, /b3-button--text|fn__space|group--stacked/);
    let extra = 0;
    const danger = f.confirmDialog({title: "Title", text: "Text", isDelete: true,
        extraAction: {label: "Extra", callback: () => extra++}});
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
    const basic = f.openInputDialog({title: "Name", value: "", onConfirm() {}});
    assert.match(basic.options.content, /b3-dialog__action mobile-sheet-action-bar/);
    assert.doesNotMatch(basic.options.content, /group--stacked|fn__space|b3-button--text/);
    const dialog = f.openInputDialog({title: "Name", value: "", onConfirm() {}, actions: [
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
