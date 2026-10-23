import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join, posix} from "node:path";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {DOMFixture, DOMElement} from "./testDOM";
import * as insertPosition from "../../upload/insertPosition";
import * as uploadResult from "../../upload/uploadResult";
import * as fetchAppId from "../../../util/fetchAppId";
import * as viewType from "./viewType";

const compile = (file: string) => transpileModule(readFileSync(join(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
}).outputText;
const assetSource = compile("asset.ts");
const uploadSource = compile("../../upload/index.ts");
type UploadKind = "picker" | "drop" | "paste";
const settle = () => new Promise(resolve => setImmediate(resolve));

// 组合执行资源字段消费者和完整上传模块，使用真实父子节点连接状态，控制插件与网络的异步边界。
const createHarness = (standalone = true) => {
    const document = new DOMFixture();
    const owner = document.createElement("div");
    owner.className = standalone ? "protyle-db-row" : "protyle";
    document.body.append(owner);
    let block: DOMElement;
    let cell: DOMElement;
    const value = {id: "value", type: "mAsset", mAsset: [
        {type: "image", name: "original.png", content: "assets/original.png"},
    ]};
    const render = () => {
        const next = document.createElement("div");
        next.innerHTML = `<div data-av-id="database" data-node-id="carrier" data-attribute-id="row" data-av-type="table">
<div class="custom-attr__avvalue" data-av-id="database" data-row-id="row" data-col-id="assets" data-id="value" data-type="mAsset"></div>
</div>`;
        if (block) {
            block.replaceWith(next.firstElementChild);
        } else {
            owner.append(next.firstElementChild);
        }
        block = owner.firstElementChild;
        cell = block.firstElementChild;
        cell.dataset.cellValue = encodeURIComponent(JSON.stringify(value));
    };
    render();
    const ghost = document.createElement("div");
    const protyle = {
        element: standalone ? ghost : owner,
        block: {rootID: "document"}, notebookId: "notebook", disabled: false,
        app: {plugins: [] as unknown[]}, wysiwyg: {element: ghost},
        upload: {element: {style: {}}, isUploading: false},
        options: {upload: {max: 1024, accept: "", filename: (name: string) => name,
            extraData: {}, fieldName: "file[]", url: "/api/asset/upload"}},
    };
    const operations: IOperation[] = [];
    const messages: string[] = [];
    const pluginWaits: Array<() => void> = [];
    const requests: Array<{id: string, respond: () => void}> = [];
    const confirmations: Array<() => void> = [];
    let delayConfirmation = false;
    let destroyed = 0;
    let onComplete = () => {};
    const response = (name: string) => ({code: 0, data: {succMap: {[name]: `assets/${name}`},
        succFiles: [{index: 0, name, path: `assets/${name}`}]}});
    class FormDataStub {
        public values = new Map<string, unknown>();
        public append(key: string, item: unknown) { this.values.set(key, item); }
    }
    class XHRStub {
        public static DONE = 4;
        public readyState = 0;
        public status = 200;
        public responseText = "";
        public upload = {};
        public onreadystatechange: () => void;
        public open() {}
        public setRequestHeader() {}
        public send(form: FormDataStub) {
            const name = (form.values.get("file[]") as File).name;
            requests.push({id: form.values.get("id") as string, respond: () => {
                this.readyState = 4;
                this.responseText = JSON.stringify(response(name));
                this.onreadystatechange();
            }});
        }
    }
    const mocks: Record<string, unknown> = {
        "./insertPosition": insertPosition,
        "../../upload/insertPosition": insertPosition,
        "./uploadResult": uploadResult,
        "../../upload/uploadResult": uploadResult,
        "../../util/fetchAppId": fetchAppId,
        "../runtimeCapabilities": {isProtyleUploadDisabled: () => false},
        "../util/destroy": {destroy() { destroyed++; }},
        "../../util/hostCapabilities": {getHostCapabilities: () => ({localFileSystem: true})},
        "./viewType": viewType,
        "./virtualScroll": {getAVData: (): IAV | undefined => undefined},
        "./col": {getColId: (item: HTMLElement) => item.dataset.colId},
        "./row": {getFieldIdByCellElement: (item: HTMLElement) => item.dataset.rowId},
        "./batchValue": {getAVBatchEditMode: () => "replace"},
        "../../../util/pathName": {pathPosix: () => posix},
        "../../util/hasClosest": {hasClosestBlock: (item: HTMLElement) => item.parentElement},
        "../../wysiwyg/transaction": {transaction: (_p: unknown, ops: IOperation[]) => operations.push(...ops)},
        "./action": {updateAttrViewCellAnimation() {}},
        "./cell": {
            getTypeByCellElement: (item: HTMLElement) => item.dataset.type,
            genCellValueByElement: (_type: string, item: HTMLElement) => JSON.parse(decodeURIComponent(item.dataset.cellValue)),
            updateAttrViewCellInOtherElements: (_p: unknown, _av: string, _row: string, _col: string,
                                               next: typeof value, item: HTMLElement) => {
                Object.assign(value, next);
                item.dataset.cellValue = encodeURIComponent(JSON.stringify(next));
            },
        },
        "dayjs": () => ({format: () => "20261014070000"}),
        "../../util/escape": {escapeHtml: (text: string) => text},
        "../../dialog/confirmDialog": {confirmDialog: (_title: string, _message: string, yes: () => void) => {
            if (delayConfirmation) {
                confirmations.push(yes);
            } else {
                yes();
            }
        }},
        "../../util/fetch": {fetchSyncPost: (_url: string, data: {id: string, assetPaths: string[]}) =>
            new Promise(resolve => requests.push({id: data.id, respond: () => resolve(response(data.assetPaths[0].split("/").pop()))}))},
        "./pluginEvent": {prepareAssetUpload: ({input}: {input: IAssetUploadInput}) => new Promise(resolve => {
            pluginWaits.push(() => resolve({state: "ready", task: {input, startUpload() {}, complete() {
                onComplete();
                return true;
            }}}));
        })},
    };
    for (const prefix of ["../../", "../../../"]) {
        mocks[prefix + "constants"] = {Constants: {SIZE_UPLOAD_TIP_SIZE: 1024, SIYUAN_APPID: "upload-window",
            SIYUAN_ASSETS_IMAGE: [".png"]}};
        mocks[prefix + "dialog/message"] = {showMessage: (message: string) => messages.push(message), hideMessage() {}};
    }
    const load = <T>(source: string) => {
        const module = {exports: {} as T};
        runInNewContext(source, {
            module, exports: module.exports, require: (name: string) => mocks[name] || {}, Promise,
            document: {body: document.body, baseURI: "https://siyuan.test/stage/build/app/", querySelector: (): Element | null => null},
            location: {origin: "https://siyuan.test"},
            window: {siyuan: {languages: {uploadInsertTargetUnavailable: "unavailable", uploading: "uploading"}}},
            FormData: FormDataStub, XMLHttpRequest: XHRStub, DataTransferItem: class {}, console,
        });
        return module.exports;
    };
    mocks["../../upload"] = load(uploadSource);
    const api = load<typeof import("./asset")>(assetSource);
    const start = (kind: UploadKind, name = "image.png") => {
        const files = [new File(["image"], name, {type: "image/png"})];
        if (kind === "picker") {
            const menu = document.createElement("div");
            const input = document.createElement("input");
            Object.assign(input, {files});
            menu.append(input);
            api.bindAssetEvent({protyle: protyle as unknown as IProtyle, blockElement: block as unknown as Element,
                cellElements: [cell as unknown as HTMLElement], menuElement: menu as unknown as HTMLElement});
            input.dispatch("change");
        } else if (kind === "drop") {
            api.dragUpload([{path: "/" + name, size: 5}], protyle as unknown as IProtyle, cell as unknown as HTMLElement);
        } else {
            api.uploadFilesToAssetCell(files, protyle as unknown as IProtyle, cell as unknown as HTMLElement, {source: "paste"});
        }
    };
    return {start, render, protyle, owner, value, operations, requests, messages,
        get block() { return block; }, get cell() { return cell; },
        get destroyed() { return destroyed; },
        resume: async () => { assert.ok(pluginWaits.length); pluginWaits.shift()(); await settle(); },
        complete: async (index = 0) => { requests[index].respond(); await settle(); },
        onComplete: (callback: () => void) => { onComplete = callback; },
        delayConfirmation: () => { delayConfirmation = true; },
        confirm: async () => { assert.ok(confirmations.length); confirmations.shift()(); await settle(); },
    };
};

describe("database asset upload lifecycle", () => {
    for (const kind of ["picker", "drop", "paste"] as const) {
        for (const standalone of [true, false]) {
            it(`${kind}: writes the original cell with a ${standalone ? "detached context" : "connected editor"}`, async () => {
                const h = createHarness(standalone);
                assert.equal(h.protyle.element.isConnected, !standalone);
                h.start(kind);
                await h.resume();
                assert.equal(h.requests.length, 1);
                assert.equal(h.requests[0].id, "document");
                await h.complete();
                const updates = h.operations.filter(op => op.action === "updateAttrViewCell");
                assert.equal(updates.length, 1);
                assert.equal(updates[0].avID, "database");
                assert.equal(updates[0].rowID, "row");
                assert.equal(updates[0].keyID, "assets");
                assert.equal(h.destroyed, 0);
                assert.deepEqual(h.value.mAsset.map(item => item.content), ["assets/original.png", "assets/image.png"]);
                assert.ok(h.messages.every(message => message.includes("uploading")));
            });
        }
        const changes = {
            close: (h: ReturnType<typeof createHarness>) => h.owner.remove(),
            row: (h: ReturnType<typeof createHarness>) => { h.block.dataset.attributeId = "other-row"; h.cell.dataset.rowId = "other-row"; },
            database: (h: ReturnType<typeof createHarness>) => { h.block.dataset.avId = "other-database"; },
            carrier: (h: ReturnType<typeof createHarness>) => { h.block.dataset.nodeId = "other-carrier"; },
            delete: (h: ReturnType<typeof createHarness>) => h.cell.remove(),
            field: (h: ReturnType<typeof createHarness>) => { h.cell.dataset.colId = "other-field"; },
            type: (h: ReturnType<typeof createHarness>) => { h.cell.dataset.type = "text"; },
            document: (h: ReturnType<typeof createHarness>) => { h.protyle.block.rootID = "other-document"; },
            notebook: (h: ReturnType<typeof createHarness>) => { h.protyle.notebookId = "other-notebook"; },
            lock: (h: ReturnType<typeof createHarness>) => { h.protyle.disabled = true; },
        };
        for (const [name, change] of Object.entries(changes)) {
            for (const stage of ["plugin", "request", "completion"] as const) {
                it(`${kind}: rejects ${name} changes during ${stage}`, async () => {
                    const h = createHarness();
                    h.start(kind);
                    if (stage === "plugin") {
                        change(h);
                    }
                    await h.resume();
                    if (stage === "plugin") {
                        assert.equal(h.requests.length, 0);
                    } else {
                        assert.equal(h.requests.length, 1);
                        if (stage === "request") {
                            change(h);
                        } else {
                            h.onComplete(() => change(h));
                        }
                        await h.complete();
                    }
                    assert.equal(h.operations.length, 0);
                    assert.equal(h.value.mAsset.length, 1);
                });
            }
        }
        it(`${kind}: uploads ordinary files as file assets`, async () => {
            const h = createHarness();
            h.start(kind, "notes.txt");
            await h.resume();
            await h.complete();
            assert.equal(h.value.mAsset[1].type, "file");
            assert.equal(h.value.mAsset[1].name, "notes.txt");
            assert.equal(h.value.mAsset[1].content, "assets/notes.txt");
        });
        it(`${kind}: rechecks a closed owner after upload confirmation`, async () => {
            const h = createHarness();
            h.delayConfirmation();
            h.start(kind);
            await h.resume();
            assert.equal(h.requests.length, 0);
            h.owner.remove();
            await h.confirm();
            assert.equal(h.requests.length, 0);
            assert.equal(h.operations.length, 0);
        });
        for (const stage of ["plugin", "request", "completion"] as const) {
            it(`${kind}: still rejects an ordinary editor closed during ${stage}`, async () => {
                const h = createHarness(false);
                h.start(kind);
                if (stage === "plugin") {
                    h.owner.remove();
                }
                await h.resume();
                if (stage === "plugin") {
                    assert.equal(h.requests.length, 0);
                } else {
                    assert.equal(h.requests.length, 1);
                    if (stage === "request") {
                        h.owner.remove();
                    } else {
                        h.onComplete(() => h.owner.remove());
                    }
                    await h.complete();
                    assert.equal(h.destroyed, stage === "request" ? 1 : 0);
                }
                assert.equal(h.operations.length, 0);
            });
        }
        it(`${kind}: preserves both uploads when the visible row is refreshed`, async () => {
            const h = createHarness();
            h.start(kind, "first.png");
            h.start(kind, "second.png");
            await h.resume();
            await h.resume();
            h.render();
            await h.complete(0);
            h.render();
            await h.complete(1);
            assert.deepEqual(h.value.mAsset.map(item => item.content), ["assets/original.png", "assets/first.png", "assets/second.png"]);
            assert.equal(h.operations.filter(op => op.action === "updateAttrViewCell").length, 2);
        });
    }
});
