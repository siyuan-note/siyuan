import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = async () => {
    class Control {
        value = "";
        checked = false;
        disabled = false;
        textContent = "";
        options: Array<{value: string; disabled: boolean}> = [];
        listeners: Record<string, () => Promise<void> | void> = {};
        addEventListener(name: string, callback: () => Promise<void> | void) { this.listeners[name] = callback; }
        replaceChildren() { this.options = []; this.value = ""; }
        add(option: {value: string; disabled: boolean}) { this.options.push(option); this.value ||= option.value; }
    }
    const controls: Record<string, Control> = {};
    for (const name of ["source", "target", "convert", "withSubheadings", "tip", "cancel"]) controls[name] = new Control();
    let closed = false;
    let pending = false;
    let current = true;
    let previewCode = 0;
    let hasOperations = true;
    let requests = 0;
    let reloads = 0;
    let complete: () => void;
    let fail: (error: Error) => void;
    class Dialog {
        element = {querySelector: (selector: string) => controls[selector.includes("cancel") ? "cancel" : selector.split('"')[1]]};
        constructor(private options: {destroyCallback: () => void}) {}
        destroy() { if (pending) return; closed = true; this.options.destroyCallback(); }
        invalidate() { closed = true; this.options.destroyCallback(); }
        async runPending(task: () => Promise<boolean>) {
            if (pending) return false;
            pending = true;
            let success = false;
            try { success = await task(); } catch { success = false; }
            pending = false;
            if (success) this.destroy();
            return success;
        }
    }
    const data = {title: "Fixture", counts: [2, 1, 0, 0, 0, 0], withSubheadingCounts: [3, 1, 0, 0, 0, 0]};
    const dependencies = {MobileDialog: Dialog, isMobile: () => true, escapeHtml: (value: string) => value,
        fetchPost: (_url: string, _body: unknown, callback: (response: unknown) => void) => callback({data}),
        fetchSyncPost: async () => ({code: previewCode, data: {...data, transaction:
            {doOperations: hasOperations ? [{action: "update", id: "heading"}] : [], undoOperations: [] as IOperation[]}}}),
        waitForPendingTransactions: async (): Promise<void> => {},
        transaction: (_protyle: unknown, _do: unknown, _undo: unknown, options: {awaitResponse: boolean; callback: () => void}) => {
            assert.equal(options.awaitResponse, true);
            requests++;
            return new Promise<void>((resolve, reject) => {
                complete = () => { options.callback(); resolve(); };
                fail = reject;
            });
        },
        reloadProtyle: () => { reloads++; },
    };
    const exports = {} as typeof import("./headingBatch");
    runInNewContext(transpileModule(readFileSync("src/protyle/util/headingBatch.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {exports, require: () => dependencies,
        Option: class {disabled = false; constructor(public text: string, public value: string) {}},
        window: {siyuan: {config: {}, languages: new Proxy({}, {get: (_, key) => String(key) + "{count}{heading}{title}"})}},
    });
    const protyle = {block: {rootID: "document"}, element: {isConnected: true},
        wysiwyg: {flushPendingInput: async (): Promise<void> => {}}} as unknown as IProtyle;
    await exports.showHeadingBatchDialog(protyle, () => current);
    return {controls, convert: () => controls.convert.listeners.click(),
        closed: () => closed, pending: () => pending, requests: () => requests, reloads: () => reloads,
        complete: () => complete(), fail: () => fail(new Error("Save failed")),
        invalidate: () => { current = false; }, setPreviewCode: (code: number) => { previewCode = code; },
        noOperations: () => { hasOperations = false; }};
};

test("heading batch retains failed conversions and retries until the transaction acknowledges success", async () => {
    const f = await fixture();
    const saving = f.convert();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.pending(), true);
    assert.equal(f.closed(), false);
    await f.convert();
    assert.equal(f.requests(), 1);
    f.fail();
    await saving;
    assert.equal(f.closed(), false);
    assert.equal(f.controls.source.disabled, false);
    assert.equal(f.controls.convert.disabled, false);
    const retry = f.convert();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.requests(), 2);
    f.complete();
    await retry;
    assert.equal(f.closed(), true);
    assert.equal(f.reloads(), 1);
});

test("heading batch handles preview failures, empty conversions and invalidated owners without writing", async () => {
    const f = await fixture();
    f.setPreviewCode(-1);
    await f.convert();
    assert.equal(f.closed(), false);
    assert.equal(f.controls.convert.disabled, false);
    f.setPreviewCode(0);
    f.noOperations();
    await f.convert();
    assert.equal(f.closed(), false);
    assert.equal(f.requests(), 0);
    f.invalidate();
    await f.convert();
    assert.equal(f.requests(), 0);
});
