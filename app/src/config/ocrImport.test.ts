import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/ocrImport.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fileIds = ["detector", "detectorConfig", "recognizer", "recognizerConfig"];

const createImportDialog = () => {
    const listeners = new Map<string, (event: unknown) => unknown>();
    const controls: Record<string, {id: string, files?: Array<{name: string}>, clicked?: number, disabled?: boolean,
        textContent?: string, title?: string, click?: () => void,
        addEventListener: (name: string, callback: (event: unknown) => unknown) => void}> = {};
    fileIds.forEach(id => {
        controls[id] = {
            id, files: [], clicked: 0,
            click() { controls[id].clicked++; },
            addEventListener: (name, callback) => listeners.set(`${id}:${name}`, callback),
        };
        controls[`${id}Name`] = {
            id: `${id}Name`, textContent: "", title: "",
            addEventListener: (name, callback) => listeners.set(`${id}Name:${name}`, callback),
        };
    });
    controls.ocrImportCancel = {id: "ocrImportCancel", addEventListener: (name, callback) => listeners.set(`ocrImportCancel:${name}`, callback)};
    controls.ocrImportConfirm = {id: "ocrImportConfirm", disabled: true, addEventListener: (name, callback) => listeners.set(`ocrImportConfirm:${name}`, callback)};
    const element = {
        querySelector: (selector: string) => controls[selector.slice(1)],
        addEventListener: (name: string, callback: (event: unknown) => unknown) => listeners.set(name, callback),
    };
    const requests: Array<{url: string, process: boolean, body: Record<string, unknown>,
        resolve: (response: {code: number, msg?: string}) => void, reject: (error: Error) => void}> = [];
    const messages: string[] = [];
    let options: {title?: string, content: string, width?: string, destroyCallback?: () => void};
    let destroyed = 0;
    const opened: number[] = [];
    let closed = 0;
    const exports = {} as {openOCRImportModelsDialog: (value: {signal: AbortSignal, onImported: () => void, onClosed: () => void}) => unknown};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {languages: new Proxy({}, {get: (_target, key) => String(key)})}},
        require: () => ({
            isMobile: () => false,
            escapeAttr: (value: string) => value,
            escapeHtml: (value: string) => value,
            ContractFormData: class {
                public readonly apiRequest: Record<string, unknown>;
                constructor(request: Record<string, unknown>) { this.apiRequest = request; }
            },
            showMessage: (message: string) => messages.push(message),
            fetchSyncPost: (url: string, data: {apiRequest: Record<string, unknown>}, _headers: unknown, process: boolean) =>
                new Promise<{code: number, msg?: string}>((resolve, reject) =>
                    requests.push({url, process, body: data.apiRequest, resolve, reject})),
            Dialog: class {
                public element = element;
                constructor(value: typeof options) { options = value; }
                destroy() { destroyed++; options.destroyCallback?.(); }
            },
        }),
    });
    const controller = new AbortController();
    const dialog = exports.openOCRImportModelsDialog({
        signal: controller.signal,
        onImported: () => opened.push(1),
        onClosed: () => { closed++; },
    }) as {destroy: () => void};
    return {
        options, controls, requests, messages, element, dialog, controller,
        destroyed: () => destroyed, imported: () => opened.length, closed: () => closed,
        choose: (id: string) => {
            listeners.get("click")({target: {closest: () => ({dataset: {ocrFile: id}})}});
        },
        select: (id: string, name: string) => {
            controls[id].files = [{name}];
            listeners.get("change")({target: controls[id]});
        },
        cancel: () => listeners.get("ocrImportCancel:click")({}),
        confirm: () => listeners.get("ocrImportConfirm:click")({}) as Promise<void>,
    };
};

test("the dialog lists the four model files and keeps import disabled until all are chosen", () => {
    const panel = createImportDialog();
    assert.equal(panel.options.title, "ocrImportModelsTitle");
    assert.equal(panel.options.width, "520px");
    fileIds.forEach(id => assert.match(panel.options.content, new RegExp(`id="${id}" class="fn__none" type="file"`)));
    assert.equal(panel.options.content.match(/accept="\.onnx"/g).length, 2);
    assert.equal(panel.options.content.match(/accept="\.yml,\.yaml"/g).length, 2);
    assert.equal(panel.options.content.match(/data-ocr-file=/g).length, 4);
    assert.equal(panel.controls.ocrImportConfirm.disabled, true);
    fileIds.slice(0, 3).forEach(id => panel.select(id, `${id}.onnx`));
    assert.equal(panel.controls.ocrImportConfirm.disabled, true);
    panel.select(fileIds[3], "recognizerConfig.yml");
    assert.equal(panel.controls.ocrImportConfirm.disabled, false);
});

test("choosing a file opens the matching input and shows the selected file name", () => {
    const panel = createImportDialog();
    panel.choose("recognizer");
    assert.equal(panel.controls.recognizer.clicked, 1);
    fileIds.filter(id => id !== "recognizer").forEach(id => assert.equal(panel.controls[id].clicked, 0));
    panel.select("recognizer", "model.onnx");
    assert.equal(panel.controls.recognizerName.textContent, "model.onnx");
    assert.equal(panel.controls.recognizerName.title, "model.onnx");
    assert.equal(panel.controls.detectorName.textContent, "");
});

test("importing posts the four files and closes the dialog after success", async () => {
    const panel = createImportDialog();
    fileIds.forEach(id => panel.select(id, `${id}.bin`));
    const pending = panel.confirm();
    assert.equal(panel.controls.ocrImportConfirm.disabled, true);
    assert.equal(panel.requests.length, 1);
    assert.equal(panel.requests[0].url, "/api/asset/importOCRModels");
    assert.equal(panel.requests[0].process, true);
    assert.deepEqual(Object.keys(panel.requests[0].body), fileIds);
    assert.deepEqual(Object.values(panel.requests[0].body), fileIds.map(id => ({name: `${id}.bin`})));
    panel.requests[0].resolve({code: 0});
    await pending;
    assert.deepEqual(panel.messages, ["imported"]);
    assert.equal(panel.destroyed(), 1);
    assert.equal(panel.imported(), 1);
    assert.equal(panel.closed(), 1);
});

test("a failed import keeps the dialog open and allows retrying", async () => {
    const panel = createImportDialog();
    fileIds.forEach(id => panel.select(id, `${id}.bin`));
    const pending = panel.confirm();
    panel.requests[0].resolve({code: -1});
    await pending;
    assert.deepEqual(panel.messages, []);
    assert.equal(panel.destroyed(), 0);
    assert.equal(panel.imported(), 0);
    assert.equal(panel.controls.ocrImportConfirm.disabled, false);
});

test("cancel closes the dialog without importing", () => {
    const panel = createImportDialog();
    fileIds.forEach(id => panel.select(id, `${id}.bin`));
    panel.cancel();
    assert.equal(panel.destroyed(), 1);
    assert.equal(panel.requests.length, 0);
    assert.equal(panel.imported(), 0);
});

for (const error of [new TypeError("Failed to fetch"), new SyntaxError("Unexpected end of JSON input")]) {
    test(`a rejected import reports ${error.name}, preserves file choices and allows retrying`, async () => {
        const panel = createImportDialog();
        fileIds.forEach(id => panel.select(id, `${id}.bin`));
        const choices = fileIds.map(id => panel.controls[id].files);
        const pending = panel.confirm();
        panel.requests[0].reject(error);
        await pending;
        assert.deepEqual(panel.messages, [error.message]);
        assert.equal(panel.destroyed(), 0);
        assert.equal(panel.imported(), 0);
        assert.equal(panel.controls.ocrImportConfirm.disabled, false);
        fileIds.forEach((id, index) => assert.equal(panel.controls[id].files, choices[index]));
        const retry = panel.confirm();
        panel.requests[1].resolve({code: 0});
        await retry;
        assert.equal(panel.imported(), 1);
    });
}

for (const state of ["abortError", "aborted", "closed"]) {
    test(`a rejected import stays quiet when ${state}`, async () => {
        const panel = createImportDialog();
        fileIds.forEach(id => panel.select(id, `${id}.bin`));
        const pending = panel.confirm();
        if (state === "aborted") panel.controller.abort();
        if (state === "closed") panel.cancel();
        const error = new Error("request cancelled");
        if (state === "abortError") error.name = "AbortError";
        panel.requests[0].reject(error);
        await pending;
        assert.deepEqual(panel.messages, []);
        assert.equal(panel.imported(), 0);
    });
}

for (const state of ["aborted", "closed"]) {
    test(`a late successful import stays quiet when ${state}`, async () => {
        const panel = createImportDialog();
        fileIds.forEach(id => panel.select(id, `${id}.bin`));
        const pending = panel.confirm();
        if (state === "aborted") panel.controller.abort();
        else panel.cancel();
        panel.requests[0].resolve({code: 0});
        await pending;
        assert.deepEqual(panel.messages, []);
        assert.equal(panel.imported(), 0);
        assert.equal(panel.destroyed(), state === "closed" ? 1 : 0);
    });
}
