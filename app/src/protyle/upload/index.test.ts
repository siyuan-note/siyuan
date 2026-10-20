import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import * as insertPosition from "./insertPosition";
import * as uploadResult from "./uploadResult";
import * as fetchAppId from "../../util/fetchAppId";

Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
const livePhotoPairs = require("./livePhotoPairs") as typeof import("./livePhotoPairs");

// 执行完整上传模块，替换网络、界面和插件等待，以控制文档切换发生的时刻。
const createHarness = (failLocalUpload = false) => {
    const results: Array<{status: string}> = [];
    const completions: Array<Omit<IAssetUploadResult, "requestId" | "input"> | undefined> = [];
    const requests: Array<{id: string; respond(): void}> = [];
    const headers = new Headers();
    let resolvePlugin: (prepared: unknown) => void;
    let onComplete = () => {};
    let confirm: (() => void) | undefined;
    let delayConfirmation = false;
    let renderRange: Range | undefined;
    let insertedHTML = "";
    const protyle = {
        lite: false,
        element: {isConnected: true},
        block: {rootID: "doc-a"}, notebookId: "box-a", app: {plugins: [] as unknown[]},
        wysiwyg: {element: {}},
        upload: {element: {style: {}}, isUploading: false},
        options: {upload: {max: 10, accept: "", filename: (name: string) => name,
            extraData: {}, fieldName: "file[]", url: "/upload"}},
    };
    const response = {code: 0, data: {succMap: {"image.png": "assets/image.png"},
        succFiles: [{index: 0, name: "image.png", path: "assets/image.png"}]}};
    const localResponse: {code: number; msg?: string; data: Pick<IAssetUploadResult, "succMap" | "succFiles" | "failedFiles">} =
        failLocalUpload ? {code: -1, msg: "local asset path is not allowed",
        data: {succMap: {}, succFiles: [], failedFiles: [{index: 0, name: "image.png", error: "denied"}]}} : response;
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
        setRequestHeader(name: string, value: string) { headers.set(name, value); }
        send(form: FormDataStub) {
            requests.push({id: form.values.get("id") as string, respond: () => {
                this.readyState = 4;
                this.onreadystatechange();
            }});
        }
    }
    const mocks: Record<string, unknown> = {
        "./insertPosition": {...insertPosition, getAvailableUploadInsertRange:
            (...args: Parameters<typeof insertPosition.getAvailableUploadInsertRange>) =>
                renderRange || insertPosition.getAvailableUploadInsertRange(...args)},
        "../../util/fetchAppId": fetchAppId,
        "./uploadResult": uploadResult,
        "./livePhotoPairs": livePhotoPairs,
        "../util/insertHTML": {insertHTML: (html: string) => { insertedHTML = html; }},
        "../util/hasClosest": {hasClosestBlock: (): undefined => undefined},
        "../../util/pathName": {pathPosix: () => ({extname: (name: string) => name.slice(name.lastIndexOf("."))})},
        "../../asset/renderAssets": {genAssetHTML: (type: string, path: string) =>
            type === ".heic" ? `<img src="${path}">` : `<video src="${path}"></video>`},
        "../runtimeCapabilities": {isProtyleUploadDisabled: () => false},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: true})},
        "../../constants": {Constants: {SIZE_UPLOAD_TIP_SIZE: 1024, SIYUAN_APPID: "upload-window",
            SIYUAN_ASSETS_IMAGE: [".heic"], SIYUAN_ASSETS_AUDIO: [], SIYUAN_ASSETS_VIDEO: [".mov"]}},
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
            new Promise(resolve => requests.push({id: data.id, respond: () => resolve(localResponse)}))},
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
    runInNewContext(compiled + "\nexports.renderUploadedLabel = genUploadedLabel;", {
        module, exports: module.exports, require: (name: string) => mocks[name] || {}, Promise,
        FormData: FormDataStub, XMLHttpRequest: XHRStub, DataTransferItem: class {},
        location: {origin: "https://siyuan.test"},
        document: {baseURI: "https://siyuan.test/stage/build/app/", body: {contains: () => protyle.element.isConnected}},
        window: {siyuan: {languages: {uploading: "uploading"}}}, console, setTimeout: () => 0,
    });
    const api = module.exports as typeof import("./index") & {
        renderUploadedLabel(responseText: string, protyle: IProtyle,
                            options: import("./index").IUploadInsertOptions, input: IAssetUploadInput): Promise<void>;
    };
    let consumed = 0;
    const start = (kind: "files" | "local-files", document?: insertPosition.IUploadDocument) => {
        const options = {target: "background" as const, document};
        if (kind === "files") {
            api.uploadFiles(protyle as unknown as IProtyle,
                [{name: "image.png", size: 1, type: "image/png"} as File], undefined,
                () => { consumed++; }, undefined, options);
        } else {
            api.uploadLocalFiles([{path: "/image.png", size: 1}], protyle as unknown as IProtyle,
                true, options, () => { consumed++; }, (_succeeded, result) => completions.push(result));
        }
    };
    return {protyle, requests, results, completions, start, headers, resume: () => resolvePlugin(undefined),
        delayConfirmation: () => { delayConfirmation = true; }, confirm: () => confirm(),
        consumed: () => consumed, onComplete: (callback: () => void) => { onComplete = callback; },
        renderLivePhotos: async (files: File[], pairs: import("./livePhotoPairs").ILivePhotoPair[],
                                succMap: Record<string, string>) => {
            renderRange = {toString: () => "", startContainer: {nodeType: 1}} as unknown as Range;
            await api.renderUploadedLabel(JSON.stringify({code: 0, data: {succMap}}), protyle as unknown as IProtyle,
                {livePhotoPairs: pairs}, {kind: "files", files});
            return insertedHTML;
        }};
};

const settle = () => new Promise(resolve => setImmediate(resolve));

describe("upload document binding", () => {
    it("inserts both successful stills and only their matching legacy Live Photo video after a partial upload", async () => {
        const harness = createHarness();
        const files = ["a.heic", "a.mov", "b.heic", "b.mov"].map(name => new File([name], name));
        const html = await harness.renderLivePhotos(files,
            [{photo: files[0], video: files[1]}, {photo: files[2], video: files[3]}],
            {"a.heic": "assets/a.heic", "b.heic": "assets/b.heic", "b.mov": "assets/b.mov"});
        assert.match(html, /<img src="assets\/a.heic">/);
        assert.match(html, /<img custom-sy-live-photo="1" custom-sy-live-photo-video="assets\/b.mov" src="assets\/b.heic">/);
        assert.doesNotMatch(html, /<video/);
    });

    it("delivers failed local resource results to the completion callback", async () => {
        const harness = createHarness(true);
        harness.start("local-files");
        harness.resume();
        await settle();
        harness.requests[0].respond();
        await settle();
        assert.equal(harness.consumed(), 0);
        assert.equal(harness.completions[0].status, "failed");
        assert.equal(harness.completions[0].failedFiles[0].index, 0);
    });

    it("uploads lightweight document fragments to their owning document", async () => {
        const harness = createHarness();
        harness.protyle.lite = true;
        harness.start("files");
        harness.resume();
        await settle();
        assert.equal(harness.requests.length, 1);
        assert.equal(harness.requests[0].id, "doc-a");
    });

    it("keeps standalone lightweight uploads independent of documents", async () => {
        const harness = createHarness();
        harness.protyle.lite = true;
        harness.protyle.block.rootID = "";
        harness.start("files");
        harness.resume();
        await settle();
        assert.equal(harness.requests.length, 1);
        assert.equal(harness.requests[0].id, undefined);
    });

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


it("limits upload app headers to same-origin API URLs", async () => {
    for (const url of ["/api/asset/upload", "../../../api/asset/upload", "/upload", "https://external.test/api/upload"]) {
        const harness = createHarness();
        harness.protyle.options.upload.url = url;
        harness.start("files");
        harness.resume();
        await settle();
        assert.equal(harness.requests.length, 1);
        assert.equal(harness.headers.get(fetchAppId.SIYUAN_APP_ID_HEADER),
            url.includes("/api/asset/upload") ? "upload-window" : null);
    }
});
