import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (source: string) => transpileModule(source, {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const readiness = source.slice(source.indexOf("interface IFlashcardV2Readiness"), source.indexOf("const renderReviewSet ="));
const preview = source.slice(source.indexOf("export const openFlashcardV2AnkiPreview ="), source.indexOf("const statisticsItem ="));
const forms = readFileSync("src/card/flashcardV2Form.ts", "utf8");
const operation = forms.slice(forms.indexOf("export const createFlashcardV2Operation ="),
    forms.indexOf("export const reportFlashcardV2Field =")).replace("export const", "const");
const flush = async () => { for (let i = 0; i < 16; i++) { await Promise.resolve(); } };

const setup = async () => {
    let uuid = 0;
    const createFlashcardV2Operation = runInNewContext(compile(`${operation}\ncreateFlashcardV2Operation;`), {
        genUUID: () => `operation-${++uuid}`,
    });
    const helpers = {} as {createFlashcardV2AnkiImportState: typeof import("./flashcardV2AnkiImport").createFlashcardV2AnkiImportState};
    runInNewContext(compile(readFileSync("src/card/flashcardV2AnkiImport.ts", "utf8")), {
        exports: helpers, require: () => ({createFlashcardV2Operation}),
    });
    let fileChange: () => void;
    const requests: Array<{url: string, data: Record<string, unknown>, signal?: AbortSignal, timeout?: number,
        success: (response: unknown) => void, failure?: (response: unknown) => void, settle: () => void}> = [];
    const confirmations: Array<{yes: () => void, no: () => void}> = [];
    const messages: string[] = [];
    const dialogs: Array<{clicks: Array<() => void>, buttons: Array<{disabled: boolean, textContent: string}>,
        target: {value: string, disabled: boolean}, close: () => void}> = [];
    const exports = {} as {openFlashcardV2AnkiPreview: () => void};
    runInNewContext(compile(`${readiness}\n${preview}`), {
        exports, createFlashcardV2AnkiImportState: helpers.createFlashcardV2AnkiImportState,
        document: {createElement: () => ({files: [{name: "fixture.apkg"}], type: "", accept: "",
            addEventListener: (_event: string, cb: () => void) => { fileChange = cb; }, click() {}})},
        window: {siyuan: {notebooks: [{id: "notebook", name: "Notebook"}],
            languages: new Proxy({}, {get: (_, key) => String(key)})}},
        ContractFormData: class {constructor(value: unknown) { Object.assign(this, value); }},
        Dialog: class {
            readonly element: {isConnected: boolean, dataset: Record<string, string>, querySelectorAll: () => unknown[], querySelector: () => unknown};
            constructor(private options: {beforeClose?: () => boolean}) {
                const clicks: Array<() => void> = [];
                const buttons = [0, 1].map(index => ({disabled: false, textContent: index === 0 ? "cancel" : "import",
                    addEventListener: (_event: string, cb: () => void) => { clicks[index] = cb; }}));
                const target = {value: "notebook", disabled: false};
                this.element = {isConnected: true, dataset: {}, querySelectorAll: () => buttons, querySelector: () => target};
                dialogs.push({clicks, buttons, target, close: () => this.destroy()});
            }
            destroy() {
                if (this.options.beforeClose?.() === false) { return; }
                this.element.dataset.dialogClosing = "true";
                this.element.isConnected = false;
            }
        },
        confirmDialog: (_title: string, _content: string, yes: () => void, no: () => void) => confirmations.push({yes, no}),
        isMobile: () => false, statisticsItem: () => "", escapeHtml: (value: string) => value,
        escapeAttr: (value: string) => value, showMessage: (message: string) => messages.push(message),
        fetchPost: (url: string, data: Record<string, unknown>, success: (response: unknown) => void,
            _headers?: unknown, failure?: (response: unknown) => void, signal?: AbortSignal, timeout?: number) =>
            new Promise<void>(settle => { requests.push({url, data, success, failure, signal, timeout, settle}); }),
    });
    const respond = async (index: number, data?: unknown, networkFailure = false) => {
        const request = requests[index];
        if (networkFailure) { request.failure?.({code: 400, msg: "Request timed out"}); }
        else if (data !== undefined) { request.success({data}); }
        request.settle();
        await flush();
    };
    exports.openFlashcardV2AnkiPreview();
    fileChange();
    await respond(0, {noteTypes: [], decks: [], unsupported: []});
    return {requests, dialogs, confirmations, messages, respond,
        imports: () => requests.filter(request => request.url.endsWith("importAnkiPackage"))};
};

test("Anki integration locks during readiness and rejects a second click", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    h.dialogs[0].clicks[1]();
    assert.equal(h.requests.length, 2);
    assert.equal(h.dialogs[0].buttons[1].disabled, true);
    assert.equal(h.dialogs[0].target.disabled, true);
    await h.respond(1, {state: "Active"});
    assert.equal(h.imports().length, 1);
    assert.equal(h.dialogs[0].buttons[0].textContent, "close");
});

test("Anki integration closing during readiness never sends import", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    h.dialogs[0].close();
    await h.respond(1, {state: "Active"});
    assert.equal(h.imports().length, 0);
});

test("Anki readiness timeout releases controls and permits retry", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    assert.equal(h.requests[1].timeout, 30000);
    await h.respond(1, undefined, true);
    assert.equal(h.dialogs[0].buttons[1].disabled, false);
    assert.equal(h.dialogs[0].target.disabled, false);
    assert.deepEqual(h.messages, ["flashcardSaveFailed"]);
    h.dialogs[0].clicks[1]();
    assert.equal(h.requests.length, 3);
});

test("Anki readiness business errors release controls at every readiness endpoint", async () => {
    for (const stage of ["status", "preview", "activation"]) {
        const h = await setup();
        h.dialogs[0].clicks[1]();
        if (stage !== "status") {
            await h.respond(1, {state: "Prepared"});
        }
        if (stage === "activation") {
            await h.respond(2, {report: {Complete: true}, migrationID: "migration", recordDigest: "digest"});
            h.confirmations[0].yes();
        }
        await h.respond(h.requests.length - 1);
        assert.equal(h.dialogs[0].buttons[1].disabled, false, stage);
        assert.equal(h.dialogs[0].target.disabled, false, stage);
        assert.equal(h.imports().length, 0);
    }
});

test("Anki migration cancellation and incomplete preview release controls", async () => {
    for (const complete of [false, true]) {
        const h = await setup();
        h.dialogs[0].clicks[1]();
        await h.respond(1, {state: "Prepared"});
        await h.respond(2, {report: {Complete: complete}, migrationID: "migration", recordDigest: "digest"});
        if (complete) {
            assert.equal(h.dialogs[0].buttons[1].disabled, true);
            h.confirmations[0].no();
            assert.equal(h.messages.length, 0);
        }
        assert.equal(h.dialogs[0].buttons[1].disabled, false);
        assert.equal(h.imports().length, 0);
    }
});

test("Anki import failure retries the same payload using its original operation identity", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    await h.respond(1, {state: "Active"});
    const first = h.imports()[0].data.operationID;
    await h.respond(2);
    assert.equal(h.dialogs[0].buttons[1].disabled, false);
    assert.equal(h.dialogs[0].buttons[0].textContent, "cancel");
    h.dialogs[0].clicks[1]();
    await h.respond(3, {state: "Active"});
    assert.equal(h.imports()[1].data.operationID, first);
});

test("Anki completion after closing neither aborts the write nor opens a late result dialog", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    await h.respond(1, {state: "Active"});
    assert.equal(h.imports()[0].signal, undefined);
    h.dialogs[0].clicks[0]();
    await h.respond(2, {});
    assert.equal(h.dialogs.length, 1);
});

test("Anki late migration confirmation cannot activate or import after the preview closes", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    await h.respond(1, {state: "Prepared"});
    await h.respond(2, {report: {Complete: true}, migrationID: "migration", recordDigest: "digest"});
    h.dialogs[0].close();
    h.confirmations[0].yes();
    assert.equal(h.requests.length, 3);
    assert.equal(h.imports().length, 0);
});

test("Anki successful import opens one result when the preview is still open", async () => {
    const h = await setup();
    h.dialogs[0].clicks[1]();
    await h.respond(1, {state: "Active"});
    await h.respond(2, {});
    assert.equal(h.dialogs.length, 2);
    h.dialogs[0].clicks[1]();
    assert.equal(h.imports().length, 1);
});

test("Anki network failures are visible only while the preview remains open", async () => {
    for (const closing of [false, true]) {
        const h = await setup();
        h.dialogs[0].clicks[1]();
        await h.respond(1, {state: "Active"});
        if (closing) { h.dialogs[0].close(); }
        await h.respond(2, undefined, true);
        assert.deepEqual(h.messages, closing ? [] : ["flashcardSaveFailed"]);
        assert.equal(h.dialogs.length, 1);
        if (!closing) {
            assert.equal(h.dialogs[0].buttons[1].disabled, false);
            assert.equal(h.dialogs[0].buttons[0].textContent, "cancel");
        }
    }
});
