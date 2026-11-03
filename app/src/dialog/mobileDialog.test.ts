import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = transpileModule(readFileSync("src/dialog/mobileDialog.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const setup = (mobile = true) => {
    let drag: () => Promise<boolean>;
    let canDrag: () => boolean;
    let opened: () => void;
    let resized: () => void;
    let scrolled = 0;
    let freezes = 0;
    let disposals = 0;
    let bindings = 0;
    let mode: string;
    let keyboard = 0;
    const document = {activeElement: undefined as unknown};
    const window = {siyuan: {dialogs: [] as any[], languages: {settingsPendingSaveError: "failed"}}};
    class Base {
        body = {inert: false};
        buttons: {disabled: boolean, isConnected: boolean}[] = [];
        element = {dataset: {} as Record<string, string>, isConnected: true,
            contains: () => true, addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {},
            querySelector: (selector: string) => selector === ".b3-dialog__body" ? this.body : undefined, querySelectorAll: () => this.buttons};
        constructor(public options: any) { window.siyuan.dialogs.push(this); }
        destroy(options?: any) {
            if (this.options.beforeClose?.() === false || this.element.dataset.dialogClosing) return;
            this.element.dataset.dialogClosing = "true";
            this.options.destroyCallback?.(options);
        }
        bindInput() {}
    }
    const dependencies = {Dialog: Base, isMobile: () => mobile,
        bindBottomSheetDialog: (_dialog: any, _close: any, _resize: any, open: () => void, options: {canStart: () => boolean}) => {
            drag = _close; canDrag = options.canStart;
            bindings++; opened = open; resized = _resize;
            const dispose = () => { disposals++; };
            dispose.freeze = () => { freezes++; };
            dispose.setMode = (value: string) => { mode = value; };
            return dispose;
        },
        scrollInputIntoView: () => { scrolled++; }, callMobileAppShowKeyboard: () => { keyboard++; }, setSheetExpanded() {}, Constants: {TIMEOUT_INPUT: 10}, isNotCtrl: () => true, showMessage() {}};
    const exports: any = {};
    runInNewContext(source, {exports, require: () => dependencies, window, document, console: {error() {}}});
    return {...exports, window, document, Base, drag: () => drag(), canDrag: () => canDrag(), resize: () => resized(), open: () => opened(), stats: () => ({freezes, disposals, bindings, mode, keyboard, scrolled})};
};
test("explicit mobile geometry binds once; desktop is untouched", () => {
    const mobile = setup();
    const dialog = new mobile.MobileDialog({content: ""});
    assert.equal(dialog.options.height, "auto");
    dialog.setSheetMode("expanded");
    assert.equal(mobile.stats().mode, "expanded");
    assert.equal(mobile.stats().bindings, 1);
    const desktop = setup(false);
    const original = {content: "", height: "350px", disableClose: true};
    const desktopDialog = new desktop.MobileDialog(original);
    assert.equal(desktopDialog.options, original);
    assert.equal(desktop.stats().bindings, 0);
});
test("pending false and rejection retain input; only explicit true closes and disposes once", async () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: ""});
    assert.equal(await dialog.runPending(async () => false), false);
    assert.equal(await dialog.runPending(async () => { throw Error("failed"); }), false);
    let resolve: (value: boolean) => void;
    const pending = dialog.runPending(() => new Promise<boolean>(done => { resolve = done; }));
    assert.equal(dialog.body.inert, true, "pending locks the edit region against unsaved late input");
    assert.equal(await dialog.requestClose("back"), false);
    dialog.destroy();
    assert.equal(dialog.element.dataset.dialogClosing, undefined);
    assert.equal(await dialog.runPending(async () => true), false);
    resolve(true);
    assert.equal(await pending, true);
    assert.equal(f.stats().freezes, 1);
    assert.equal(f.stats().disposals, 1);
});
test("legacy guard rejection does not freeze and invalidate still performs callback cleanup", async () => {
    const f = setup();
    let cleanup = 0;
    const dialog = new f.MobileDialog({content: "", beforeClose: () => false, destroyCallback: () => cleanup++});
    assert.equal(await dialog.requestClose("cancel"), false);
    assert.equal(f.stats().freezes, 0);
    dialog.invalidate();
    assert.equal(cleanup, 1);
    assert.equal(f.stats().freezes, 1);
});

test("pending content navigation preserves button states changed by the action", async () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: ""});
    const button = {disabled: false, isConnected: true};
    dialog.buttons.push(button);
    let finish: (value: boolean) => void;
    const pending = dialog.runPending(() => new Promise<boolean>(resolve => finish = resolve),
        {close: false, disableButtons: false});
    assert.equal(dialog.body.inert, true);
    assert.equal(button.disabled, false);
    button.disabled = true;
    finish(true);
    assert.equal(await pending, true);
    assert.equal(dialog.body.inert, false);
    assert.equal(button.disabled, true);
    assert.equal(dialog.element.dataset.dialogClosing, undefined);
});
test("passive close respects disableClose and nested topmost; explicit confirmation remains available", async () => {
    const f = setup();
    const parent = new f.MobileDialog({content: ""});
    const child = new f.MobileDialog({content: "", disableClose: true});
    assert.equal(await parent.requestClose("scrim"), false);
    assert.equal(await child.requestClose("back"), false);
    assert.equal(await child.requestClose("drag"), false);
    assert.equal(await child.requestClose("confirm"), true);
});
test("virtual destroy can open a nested confirmation without falsely reporting parent closure", async () => {
    const f = setup();
    const parent = new f.MobileDialog({content: ""});
    const destroy = parent.destroy.bind(parent);
    let approved = false;
    parent.destroy = () => { if (approved) destroy(); else new f.MobileDialog({content: ""}); };
    assert.equal(await parent.requestClose("cancel"), false);
    assert.equal(f.stats().freezes, 0);
    f.window.siyuan.dialogs.pop();
    approved = true;
    assert.equal(await parent.requestClose("cancel"), true);
});
test("async close guard is deduplicated, false retains the sheet and retry preserves reason", async () => {
    const f = setup();
    const reasons: string[] = [];
    let resolve: (value: boolean) => void;
    const dialog = new f.MobileDialog({content: "", mobileSheet: {beforeClose: (reason: string) => {
        reasons.push(reason);
        return new Promise<boolean>(done => { resolve = done; });
    }}});
    const close = dialog.requestClose("back");
    await Promise.resolve();
    assert.equal(await dialog.requestClose("back"), false);
    resolve(false);
    assert.equal(await close, false);
    assert.equal(dialog.body.inert, false, "a rejected close restores the original editing state");
    const retry = dialog.requestClose("cancel");
    await Promise.resolve();
    resolve(true);
    assert.equal(await retry, true);
    assert.deepEqual(reasons, ["back", "cancel"]);
});
test("focus waits for reveal, latest initial target wins, close and nested dialogs reject late focus", () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: ""});
    let focused = 0;
    const input = {isConnected: true, closest: (): null => null, focus: () => focused++, select() {}};
    dialog.focusWhenReady(() => input);
    dialog.focusWhenReady(() => input, {select: true});
    assert.equal(focused, 0);
    f.open();
    assert.equal(focused, 1);
    const other = new f.MobileDialog({content: ""});
    other.focusWhenReady(() => input);
    other.destroy();
    f.open();
    assert.equal(focused, 1);
    dialog.focusWhenReady(() => input);
    assert.equal(focused, 1);
});

test("the adapter module can load before the cyclic Dialog module exports its base class", () => {
    const exports: any = {};
    const dependencies: any = {};
    assert.doesNotThrow(() => runInNewContext(source, {exports, require: () => dependencies}));
    assert.equal(typeof exports.MobileDialog, "function");
});

test("native keyboard is requested once only after the requested input really receives focus", () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: ""});
    const input = {isConnected: true, closest: (): null => null, focus: () => { f.document.activeElement = input; }};
    dialog.focusWhenReady(() => input, {showKeyboard: true});
    assert.equal(f.stats().keyboard, 0);
    f.open();
    assert.equal(f.stats().keyboard, 1);
    f.document.activeElement = undefined;
    const blocked = {isConnected: true, closest: (): null => null, focus() {}};
    dialog.focusWhenReady(() => blocked, {showKeyboard: true});
    assert.equal(f.stats().keyboard, 1);
});

test("keyboard viewport updates scroll the current input without refocusing or touching closed sheets", () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: ""});
    f.document.activeElement = {};
    f.resize();
    assert.equal(f.stats().scrolled, 0);
    f.open();
    f.resize();
    assert.equal(f.stats().scrolled, 1);
    dialog.destroy();
    f.resize();
    assert.equal(f.stats().scrolled, 1);
});


test("drag binding preserves close result and blocks pending and covered sheets", async () => {
    const f = setup();
    const dialog = new f.MobileDialog({content: "", mobileSheet: {beforeClose: () => false}});
    assert.equal(f.canDrag(), true);
    assert.equal(await f.drag(), false);
    let finish: (value: boolean) => void;
    const pending = dialog.runPending(() => new Promise<boolean>(resolve => { finish = resolve; }));
    assert.equal(f.canDrag(), false);
    assert.equal(await f.drag(), false);
    finish(false);
    await pending;
    assert.equal(f.canDrag(), true);
    f.window.siyuan.dialogs.push({});
    assert.equal(f.canDrag(), false);
    assert.equal(await f.drag(), false);
    f.window.siyuan.dialogs.pop();
    dialog.invalidate();
    assert.equal(f.canDrag(), false);
});
