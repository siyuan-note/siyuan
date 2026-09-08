import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as insertPosition from "./insertPosition";
import * as uploadResult from "./uploadResult";

// 执行完整上传模块，替换网络、界面和插件等待，以控制文档切换发生的时刻。
const createHarness = () => {
    const results: Array<{status: string}> = [];
    const requests: Array<{id: string; respond(): void}> = [];
    let resolvePlugin: (prepared: unknown) => void;
    let onComplete = () => {};
    let confirm: (() => void) | undefined;
    let delayConfirmation = false;
    const protyle = {
        element: {isConnected: true},
        block: {rootID: "doc-a"}, notebookId: "box-a", app: {plugins: [] as unknown[]},
        wysiwyg: {element: {}},
        upload: {element: {style: {}}, isUploading: false},
        options: {upload: {max: 10, accept: "", filename: (name: string) => name,
            extraData: {}, fieldName: "file[]", url: "/upload"}},
    };
    const response = {code: 0, data: {succMap: {"image.png": "assets/image.png"},
        succFiles: [{index: 0, name: "image.png", path: "assets/image.png"}]}};
    class FormDataStub {
        values = new Map<string, unknown>();
        append(key: string, value: unknown) { this.values.set(key, value); }
    }
    class XHRStub {
        static DONE = 4;
        readyState = 0;
        status = 200;
        responseText = JSON.stringify(response);
        upload = {};
        onreadystatechange: () => void;
        open() {}
        send(form: FormDataStub) {
            requests.push({id: form.values.get("id") as string, respond: () => {
                this.readyState = 4;
                this.onreadystatechange();
            }});
        }
    }
    const mocks: Record<string, unknown> = {
        "./insertPosition": insertPosition,
        "./uploadResult": uploadResult,
        "../runtimeCapabilities": {isProtyleUploadDisabled: () => false},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: true})},
        "../../constants": {Constants: {SIZE_UPLOAD_TIP_SIZE: 1024}},
        "../../util/escape": {escapeHtml: (value: string) => value},
        "../../dialog/message": {showMessage: () => "message", hideMessage: () => {}},
        "../../dialog/confirmDialog": {confirmDialog: (_title: string, _msg: string, yes: () => void) => {
            if (delayConfirmation) {
                confirm = yes;
            } else {
                yes();
            }
        }},
        "../../util/fetch": {fetchSyncPost: (_url: string, data: {id: string}) =>
            new Promise(resolve => requests.push({id: data.id, respond: () => resolve(response)}))},
        "./pluginEvent": {prepareAssetUpload: ({input}: {input: IAssetUploadInput}) => {
            const task = {input, startUpload() {}, complete(result: {status: string}) {
                results.push(result);
                onComplete();
                return true;
            }};
            return new Promise(resolve => {
                resolvePlugin = () => resolve({state: "ready", task});
            });
        }},
    };
    const module = {exports: {}};
    const source = readFileSync(join(__dirname, "index.ts"), "utf8");
    const compiled = ts.transpileModule(source, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    }}).outputText;
    runInNewContext(compiled, {
        module, exports: module.exports, require: (name: string) => mocks[name] || {}, Promise,
        FormData: FormDataStub, XMLHttpRequest: XHRStub, DataTransferItem: class {},
        document: {body: {contains: () => protyle.element.isConnected}},
        window: {siyuan: {languages: {uploading: "uploading"}}}, console,
    });
    const api = module.exports as typeof import("./index");
    let consumed = 0;
    const start = (kind: "files" | "local-files", document?: insertPosition.IUploadDocument) => {
        const options = {target: "background" as const, document};
        if (kind === "files") {
            api.uploadFiles(protyle as unknown as IProtyle,
                [{name: "image.png", size: 1, type: "image/png"} as File], undefined,
                () => { consumed++; }, undefined, options);
        } else {
            api.uploadLocalFiles([{path: "/image.png", size: 1}], protyle as unknown as IProtyle,
                true, options, () => { consumed++; });
        }
    };
    return {protyle, requests, results, start, resume: () => resolvePlugin(undefined),
        delayConfirmation: () => { delayConfirmation = true; }, confirm: () => confirm(),
        consumed: () => consumed, onComplete: (callback: () => void) => { onComplete = callback; }};
};

const settle = () => new Promise(resolve => setImmediate(resolve));

describe("upload document binding", () => {
    for (const kind of ["files", "local-files"] as const) {
        it(`${kind}: preserves the document captured by a parent paste operation`, () => {
            const harness = createHarness();
            const target = insertPosition.captureUploadDocument(harness.protyle as unknown as IProtyle);
            harness.protyle.block.rootID = "doc-b";
            harness.start(kind, target);
            assert.equal(harness.requests.length, 0);
            assert.equal(harness.consumed(), 0);
        });

        it(`${kind}: rechecks the document after upload confirmation`, async () => {
            const harness = createHarness();
            harness.delayConfirmation();
            harness.start(kind);
            harness.resume();
            await settle();
            harness.protyle.block.rootID = "doc-b";
            harness.confirm();
            await settle();
            assert.equal(harness.requests.length, 0);
            assert.equal(harness.results[0].status, "canceled");
        });

        it(`${kind}: cancels before sending when the document changes during plugin processing`, async () => {
            const harness = createHarness();
            harness.start(kind);
            harness.protyle.block.rootID = "doc-b";
            harness.resume();
            await settle();
            assert.equal(harness.requests.length, 0);
            assert.equal(harness.results[0].status, "canceled");
            assert.equal(harness.consumed(), 0);
        });

        for (const switchAt of ["never", "response", "completion"] as const) {
            it(`${kind}: preserves the resource result with document switching at ${switchAt}`, async () => {
                const harness = createHarness();
                harness.start(kind);
                harness.resume();
                await settle();
                assert.equal(harness.requests[0].id, "doc-a");
                if (switchAt === "response") {
                    harness.protyle.block.rootID = "doc-b";
                } else if (switchAt === "completion") {
                    harness.onComplete(() => { harness.protyle.block.rootID = "doc-b"; });
                }
                harness.requests[0].respond();
                await settle();
                assert.equal(harness.results[0].status, "success");
                assert.equal(harness.consumed(), switchAt === "never" ? 1 : 0);
            });
        }
    }
});
