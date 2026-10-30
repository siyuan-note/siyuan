import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {queueTransaction, waitForPendingTransactions} from "../util/transactionQueue";

test("desktop tab close awaits title acknowledgement, preserves failures and ignores moved or replaced tabs", async () => {
    const source = transpileModule(readFileSync(join(__dirname, "documentTitleClose.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const moduleExports: {flushDocumentTitleBeforeClose?: (editor: object, close: () => void, valid: () => boolean) => false | Promise<boolean>} = {};
    let messages = 0;
    runInNewContext(source, {exports: moduleExports, console: {error: () => {}},
        window: {siyuan: {languages: {settingsPendingSaveError: "Save failed"}}},
        require: () => ({showMessage: () => messages++})});
    let accept: () => void;
    let reject: (error: Error) => void;
    let pending = new Promise<void>((resolve, failure) => { accept = resolve; reject = failure; });
    let titleFlushes = 0;
    let bodyFlushes = 0;
    let closed = 0;
    const editor = {protyle: {title: {flushPendingInput: () => { titleFlushes++; return pending; }}},
        flushPendingTransactions: async () => { bodyFlushes++; }};
    const close = () => { closed++; };
    const failed = moduleExports.flushDocumentTitleBeforeClose(editor, close, () => true);
    assert.equal(moduleExports.flushDocumentTitleBeforeClose(editor, close, () => true), failed);
    assert.equal(titleFlushes, 1, "repeated close does not duplicate in-flight saves");
    assert.equal(closed, 0);
    reject(new Error("Conflict"));
    assert.equal(await failed, false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, 0);
    assert.equal(messages, 1);
    pending = new Promise<void>(resolve => { accept = resolve; });
    const successful = moduleExports.flushDocumentTitleBeforeClose(editor, close, () => true);
    accept();
    assert.equal(await successful, true);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, 1);
    assert.equal(bodyFlushes, 1);
    assert.equal(await moduleExports.flushDocumentTitleBeforeClose(editor, close, () => false), false);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(closed, 1, "a previously moved or replaced tab must remain open");
    assert.equal(bodyFlushes, 1, "invalidated editors cannot submit more body input");
    pending = new Promise<void>((_resolve, failure) => { reject = failure; });
    let valid = true;
    moduleExports.flushDocumentTitleBeforeClose(editor, close, () => valid);
    valid = false;
    reject(new Error("Notebook locked"));
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(messages, 1, "forced source removal does not display stale ordinary-close errors");
    assert.equal(moduleExports.flushDocumentTitleBeforeClose({protyle: {title: {flushPendingInput: () => {}}}}, close, () => true), false,
        "plain notebook title close remains synchronous");
});

test("closing through the actual Protyle flush saves title edits made while the body queue drains", async () => {
    const compile = (source: string) => transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const tick = () => new Promise<void>(resolve => setImmediate(resolve));
    const timers = new Map<number, () => void>();
    let timerID = 0;
    const window = {siyuan: {languages: {settingsPendingSaveError: "Save failed"}},
        setTimeout: (callback: () => void) => { timers.set(++timerID, callback); return timerID; }};
    const requests: Array<{data: {transactions: Array<{doOperations: Array<{data: {blockDOM: string}}>}>},
        resolve: (value: unknown) => void}> = [];
    const richExports: {DocumentTitleEditor?: {prototype: any}} = {};
    runInNewContext(compile(readFileSync(join(__dirname, "documentTitleEditor.ts"), "utf8")), {
        exports: richExports, window, clearTimeout: (id: number) => timers.delete(id), require: (name: string) => {
            if (name === "../../util/fetch") return {fetchSyncPost: (_url: string, data: typeof requests[number]["data"]) =>
                new Promise(resolve => requests.push({data, resolve}))};
            if (name === "../util/transactionQueue") return {queueTransaction};
            if (name === "../../constants") return {Constants: {SIYUAN_APPID: "app", TIMEOUT_INPUT: 256}};
            if (name === "./documentTitleDOM") return {
                prepareDocumentTitleBlockDOM: (html: string) => html, getDocumentTitleDOMFingerprint: (html: string) => html,
            };
            return {};
        },
    });
    let html = "saved title";
    let bodyFlushed = false;
    const owner = {id: "owner", block: {rootID: "document"}, undo: {add: () => {}},
        wysiwyg: {flushPendingInput: async () => { bodyFlushed = true; }}, title: undefined as unknown};
    const rich = Object.assign(Object.create(richExports.DocumentTitleEditor.prototype), {
        owner, saved: html, revision: "r0", updateEditable: () => {},
        fragment: {getBlockHTML: () => html, protyle: {wysiwyg: {flushPendingInput: async () => {}}},
            destroy: () => {}, wysiwyg: {replaceChildren: () => { html = ""; }}},
        refresh: async () => { rich.refreshPending = false; },
    });
    const titleExports: {Title?: {prototype: any}} = {};
    runInNewContext(compile(readFileSync(join(__dirname, "Title.ts"), "utf8")), {
        exports: titleExports, require: () => ({}),
    });
    owner.title = Object.assign(Object.create(titleExports.Title.prototype), {richEditor: rich});
    const protyleSource = readFileSync(join(__dirname, "../index.ts"), "utf8");
    const flushBody = protyleSource.match(/public async flushPendingTransactions\(\) \{([\s\S]*?)\n {4}\}/)?.[1];
    assert.ok(flushBody);
    const flushExports: {flush?: () => Promise<void>} = {};
    runInNewContext(compile(`exports.flush = async function() {${flushBody}};`), {
        exports: flushExports, waitForPendingTransactions,
    });
    const editor = {protyle: owner, flushPendingTransactions: flushExports.flush};
    const closeExports: {flushDocumentTitleBeforeClose?: (value: unknown, close: () => void, valid: () => boolean) => false | Promise<boolean>} = {};
    runInNewContext(compile(readFileSync(join(__dirname, "documentTitleClose.ts"), "utf8")), {
        exports: closeExports, window, console, require: () => ({showMessage: () => {}}),
    });
    let finishBody: () => void;
    void queueTransaction(owner as unknown as IProtyle, () => new Promise<void>(resolve => { finishBody = resolve; }));
    let closed = false;
    closeExports.flushDocumentTitleBeforeClose(editor, () => { closed = true; rich.destroy(); }, () => true);
    await tick();
    assert.equal(bodyFlushed, true);
    assert.equal(closed, false);
    html = "typed while the body acknowledgement was pending";
    rich.changed();
    assert.equal(timers.size, 1);
    finishBody();
    await tick();
    assert.equal(closed, false, "body acknowledgement alone must not close a newly dirty title");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.transactions[0].doOperations[0].data.blockDOM, html);
    requests[0].resolve({code: 0, data: [{doOperations: [{action: "setDocTitle", id: "document", retData: "r1"}]}]});
    await tick();
    assert.equal(closed, true);
    assert.equal(rich.saved, "typed while the body acknowledgement was pending");
    assert.equal(timers.size, 0);
});
