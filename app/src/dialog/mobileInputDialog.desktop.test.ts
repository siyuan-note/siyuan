import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isArrowFunction, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const setup = () => {
    const document = {activeElement: undefined as unknown};
    const dialogs: any[] = [];
    const errors: unknown[] = [];
    let restored = 0;
    let sheetBindings = 0;
    const window = {siyuan: {dialogs, languages: {
        confirm: "Confirm", cancel: "Cancel", callout: "Callout", custom: "Custom", type: "Type",
        settingsPendingSaveError: "Save failed",
    }}};
    class Input {
        value = "";
        disabled = false;
        isConnected = true;
        listeners: Record<string, () => void> = {};
        addEventListener(name: string, listener: () => void) { this.listeners[name] = listener; }
        click() { if (!this.disabled) this.listeners.click?.(); }
        focus() { document.activeElement = this; }
        select() {}
        closest(): null { return null; }
    }
    class BaseDialog {
        input = new Input();
        confirm = new Input();
        cancel = new Input();
        body = {inert: false};
        enter: () => void;
        element = {
            dataset: {} as Record<string, string>, isConnected: true,
            setAttribute() {}, removeAttribute() {},
            querySelector: (selector: string) => ({
                "[data-dialog-input]": this.input, "[data-input-confirm]": this.confirm,
                "[data-input-cancel]": this.cancel, ".b3-dialog__body": this.body,
            })[selector],
            querySelectorAll: (selector: string) => selector === "button" ? [this.confirm, this.cancel] : [],
        };
        constructor(public options: any) { dialogs.push(this); }
        bindInput(input: Input, enter: () => void) {
            assert.equal(input, this.input);
            this.enter = enter;
        }
        destroy() {
            if (this.element.dataset.dialogClosing === "true" || this.options.beforeClose?.() === false) return;
            this.element.dataset.dialogClosing = "true";
            this.element.isConnected = false;
            this.options.destroyCallback?.();
        }
    }
    const load = (file: string, dependencies: Record<string, unknown>) => {
        const exports: any = {};
        runInNewContext(transpileModule(readFileSync(file, "utf8"), {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText, {exports, require: (name: string) => {
            assert.ok(name in dependencies, name);
            return dependencies[name];
        }, window, document, HTMLInputElement: Input, console: {error: (error: unknown) => errors.push(error)},
        getSelection: () => ({rangeCount: 1, getRangeAt: () => ({cloneRange: () => ({startContainer: "selected"})})})});
        return exports;
    };
    const functions = {isMobile: () => false};
    const constants = {Constants: {ATTRIBUTE_EDITING: "data-editing"}};
    const adapter = load("src/dialog/mobileDialog.ts", {
        "./index": {Dialog: BaseDialog}, "../util/functions": functions,
        "../mobile/util/bindBottomSheetDialog": {bindBottomSheetDialog: () => sheetBindings++},
        "../constants": constants, "../mobile/util/mobileAppUtil": {}, "../mobile/util/visibleViewport": {},
        "../protyle/util/compatibility": {}, "./message": {showMessage: (message: string) => errors.push(message)},
    });
    const input = load("src/dialog/inputDialog.ts", {
        "./index": {Dialog: BaseDialog}, "../util/functions": functions,
        "../util/escape": {escapeHtml: (value: string) => value},
    });
    const wrapper = load("src/dialog/mobileInputDialog.ts", {
        "./mobileDialog": adapter, "./inputDialog": input, "../util/functions": functions,
        "../util/escape": {escapeHtml: (value: string) => value},
    });
    const transactions: unknown[] = [];
    let save: () => Promise<void> = () => Promise.resolve();
    const callout = load("src/protyle/wysiwyg/callout.ts", {
        "../../dialog/mobileInputDialog": wrapper, "../../constants": constants,
        "./transaction": {transaction: (...args: unknown[]) => { transactions.push(args); return save(); }},
        "../util/selectionOffsets": {focusByRange: () => restored++}, "./calloutType": {},
    });
    const block = {
        dataset: {nodeId: "callout", type: "NodeCallout", subtype: "NOTE"}, isConnected: true,
        outerHTML: '<div data-type="NodeCallout" data-subtype="NOTE">selected</div>',
        setAttribute() {},
        cloneNode: () => ({dataset: {subtype: "NOTE"}, setAttribute() {},
            get outerHTML() { return `<div data-type="NodeCallout" data-subtype="${this.dataset.subtype}">selected</div>`; }}),
    };
    const protyle = {disabled: false, wysiwyg: {element: {contains: () => block.isConnected}}};
    return {input, wrapper, BaseDialog, adapter, transactions, errors, document, block, protyle,
        setSave: (callback: () => Promise<void>) => { save = callback; },
        open: () => { callout.updateCustomCalloutType([block], protyle); return dialogs.at(-1); },
        stats: () => ({restored, sheetBindings})};
};

const settle = () => new Promise(resolve => setImmediate(resolve));

test("the public input dialog keeps its single options parameter and base dialog implementation", () => {
    const source = createSourceFile("inputDialog.ts", readFileSync("src/dialog/inputDialog.ts", "utf8"),
        ScriptTarget.ES2021, true);
    const initializer = source.statements.filter(isVariableStatement)
        .flatMap(statement => Array.from(statement.declarationList.declarations))
        .find(declaration => declaration.name.getText(source) === "openInputDialog")?.initializer;
    assert.ok(initializer && isArrowFunction(initializer));
    assert.equal(initializer.parameters.length, 1);
    const f = setup();
    const dialog = f.input.openInputDialog({title: "Public", value: "Draft", onConfirm() {}});
    assert.equal(Object.getPrototypeOf(dialog), f.BaseDialog.prototype);
    assert.equal(typeof dialog.runPending, "undefined");
    assert.equal(f.document.activeElement, dialog.input);
    assert.equal(dialog.input.value, "Draft");
});

test("desktop input wrappers supply the pending lifecycle without changing ordinary input dialogs", async () => {
    const f = setup();
    const dialog = f.open();
    assert.equal(dialog instanceof f.BaseDialog, true);
    assert.equal(typeof dialog.runPending, "function");
    assert.equal(typeof dialog.invalidate, "function");
    assert.equal(Object.getOwnPropertyDescriptor(f.BaseDialog.prototype, "runPending"), undefined);
    assert.equal(dialog.options.width, "520px");
    assert.equal(dialog.options.height, undefined);
    assert.equal(f.stats().sheetBindings, 0);
    assert.equal(f.document.activeElement, dialog.input);
    dialog.input.value = "CUSTOM";
    let finish: () => void;
    f.setSave(() => new Promise(resolve => { finish = resolve; }));
    dialog.confirm.click();
    dialog.confirm.click();
    dialog.enter();
    assert.equal(f.transactions.length, 1);
    assert.equal(dialog.body.inert, true);
    assert.equal(dialog.confirm.disabled, true);
    assert.equal(f.block.dataset.subtype, "NOTE");
    assert.equal(dialog.element.dataset.dialogClosing, undefined);
    finish();
    await settle();
    assert.equal(f.block.dataset.subtype, "CUSTOM");
    assert.equal(dialog.element.dataset.dialogClosing, "true");
    assert.equal(f.stats().restored, 1);
    assert.deepEqual(f.errors, []);
});

test("desktop callout confirmation retains invalid or failed input and supports a successful retry", async () => {
    const f = setup();
    const dialog = f.open();
    dialog.input.value = "   ";
    dialog.confirm.click();
    assert.equal(f.transactions.length, 0);
    assert.equal(dialog.element.dataset.dialogClosing, undefined);
    dialog.input.value = "CUSTOM";
    f.setSave(() => Promise.reject(new Error("save failed")));
    dialog.confirm.click();
    await settle();
    assert.equal(dialog.input.value, "CUSTOM");
    assert.equal(dialog.element.dataset.dialogClosing, undefined);
    assert.equal(dialog.confirm.disabled, false);
    assert.equal(dialog.body.inert, false);
    assert.equal(f.block.dataset.subtype, "NOTE");
    assert.equal(f.stats().restored, 0);
    assert.equal(f.errors.length, 2);
    f.setSave(() => Promise.resolve());
    dialog.enter();
    await settle();
    assert.equal(f.transactions.length, 2);
    assert.equal(f.block.dataset.subtype, "CUSTOM");
    assert.equal(dialog.element.dataset.dialogClosing, "true");
    assert.equal(f.stats().restored, 1);
});

for (const state of ["cancel", "readonly", "removed"] as const) {
    test(`desktop callout ${state} closes without submitting a stale transaction`, async () => {
        const f = setup();
        const dialog = f.open();
        dialog.input.value = "CUSTOM";
        if (state === "cancel") dialog.cancel.click();
        else {
            if (state === "readonly") f.protyle.disabled = true;
            else f.block.isConnected = false;
            dialog.confirm.click();
        }
        await settle();
        assert.equal(f.transactions.length, 0);
        assert.equal(dialog.element.dataset.dialogClosing, "true");
        assert.equal(f.stats().restored, state === "removed" ? 0 : 1);
        assert.deepEqual(f.errors, []);
    });
}
