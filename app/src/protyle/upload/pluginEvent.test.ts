import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {prepareAssetUpload} from "./pluginEvent";

type TListener = (event: CustomEvent<IBeforeUploadAssetsDetail>) => void;

const createPlugin = (listener: TListener) => ({
    eventBus: {
        emit(type: TEventBus, detail: IBeforeUploadAssetsDetail) {
            assert.equal(type, "before-upload-assets");
            let canceled = false;
            listener({
                detail,
                preventDefault() {
                    canceled = true;
                },
            } as CustomEvent<IBeforeUploadAssetsDetail>);
            return !canceled;
        },
    },
});

const createFile = (name: string) => ({name}) as File;
const protyle = {} as IProtyle;
const context = {source: "paste", target: "editor"} as const;

describe("asset upload plugin event", () => {
    it("preserves files when plugins do not respond", async () => {
        const input: IAssetUploadInput = {kind: "files", files: [createFile("a.png")]};
        const result = prepareAssetUpload({
            plugins: [createPlugin(() => undefined)],
            protyle,
            input,
            context,
            requestId: "request-1",
        });
        assert.equal(result instanceof Promise, false);
        const prepared = await result;

        assert.equal(prepared.state, "ready");
        assert.equal(prepared.task.requestId, "request-1");
        assert.deepEqual(prepared.task.input, input);
        assert.notEqual(prepared.task.input.files, input.files);
    });

    it("passes each replacement to the next plugin", async () => {
        const received: string[] = [];
        const prepared = await prepareAssetUpload({
            plugins: [
                createPlugin(event => {
                    assert.equal(event.detail.input.kind, "files");
                    received.push((event.detail.input.files[0] as File).name);
                    event.detail.respondWith(Promise.resolve({
                        action: "replace",
                        input: {kind: "files", files: [createFile("b.jpg")]},
                    }));
                }),
                createPlugin(event => {
                    assert.equal(event.detail.input.kind, "files");
                    received.push((event.detail.input.files[0] as File).name);
                    event.detail.respondWith(Promise.resolve({
                        action: "replace",
                        input: {kind: "local-files", files: [{path: "c.jpg", size: 1}]},
                    }));
                }),
            ],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "ready");
        assert.deepEqual(received, ["a.png", "b.jpg"]);
        assert.deepEqual(prepared.task.input, {
            kind: "local-files",
            files: [{path: "c.jpg", size: 1}],
        });
    });

    it("stops after immediate cancellation", async () => {
        let laterPluginCalled = false;
        const prepared = await prepareAssetUpload({
            plugins: [
                createPlugin(event => event.preventDefault()),
                createPlugin(() => {
                    laterPluginCalled = true;
                }),
            ],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "canceled");
        assert.equal(laterPluginCalled, false);
    });

    it("supports asynchronous cancellation", async () => {
        const results: IAssetUploadResult[] = [];
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                event.detail.onComplete(result => results.push(result));
                event.detail.respondWith(Promise.resolve({action: "cancel"}));
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "canceled");
        assert.equal(results.length, 1);
        assert.equal(results[0].status, "canceled");
    });

    it("reports the final result once", async () => {
        const results: IAssetUploadResult[] = [];
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                event.detail.onComplete(result => results.push(result));
                event.detail.respondWith(Promise.resolve({
                    action: "replace",
                    input: {kind: "files", files: [createFile("a.jpg")]},
                }));
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
            requestId: "request-2",
        });

        prepared.task.complete({status: "success", succMap: {"a.jpg": "assets/a.jpg"}});
        prepared.task.complete({status: "failed"});

        assert.deepEqual(results, [{
            requestId: "request-2",
            status: "success",
            input: {kind: "files", files: [createFile("a.jpg")]},
            succMap: {"a.jpg": "assets/a.jpg"},
        }]);
    });

    it("reports rejected processing as a failure", async () => {
        const results: IAssetUploadResult[] = [];
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                event.detail.onComplete(result => results.push(result));
                event.detail.respondWith(Promise.reject(new Error("compression failed")));
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "failed");
        if (prepared.state === "failed") {
            assert.equal(prepared.error, "compression failed");
        }
        assert.equal(results[0].status, "failed");
        assert.equal(results[0].error, "compression failed");
    });
});
