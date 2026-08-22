import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {EventBus} from "../../plugin/EventBusCore";
import {cancelAssetUploads, cancelAssetUploadsByPlugin, prepareAssetUpload} from "./pluginEvent";

type TListener = (event: CustomEvent<IBeforeUploadAssetsDetail>) => void;

const createPlugin = (listener: TListener) => ({
    name: "test-plugin",
    eventBus: (() => {
        const eventBus = new EventBus<IBeforeUploadAssetsDetail>("", new EventTarget());
        eventBus.on("before-upload-assets", listener);
        return eventBus;
    })(),
});

const createFile = (name: string) => new File(["content"], name, {type: "image/png"});
const protyle = {} as IProtyle;
const context = {source: "paste", target: "editor"} as const;

describe("asset upload plugin event", () => {
    it("exposes target constraints for uploads without an editor", async () => {
        let detail: IBeforeUploadAssetsDetail;
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                detail = event.detail;
            })],
            input: {kind: "files", files: [createFile("annotation.png")]},
            context: {
                source: "programmatic",
                target: "pdf-annotation",
                requiredFileCount: 1,
                allowedInputKinds: ["files"],
            },
        });

        assert.equal(prepared.state, "ready");
        assert.equal(detail.protyle, undefined);
        assert.equal(detail.requiredFileCount, 1);
        assert.deepEqual(detail.allowedInputKinds, ["files"]);
        prepared.task.complete({status: "canceled"});
    });

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

    it("isolates local file input from listener mutations", async () => {
        const originalFile: ILocalFiles = {path: "a.png", size: 1};
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                assert.equal(event.detail.input.kind, "local-files");
                if (event.detail.input.kind === "local-files") {
                    event.detail.input.files[0].path = "mutated.png";
                }
            })],
            protyle,
            input: {kind: "local-files", files: [originalFile]},
            context,
        });

        assert.equal(prepared.state, "ready");
        assert.equal(prepared.task.input.kind, "local-files");
        if (prepared.task.input.kind === "local-files") {
            assert.equal(prepared.task.input.files[0].path, "a.png");
        }
        assert.equal(originalFile.path, "a.png");
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
                createPlugin(event => event.detail.respondWith({action: "cancel"})),
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

    it("rejects preventDefault as a protocol error", async () => {
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => event.preventDefault())],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "failed");
        if (prepared.state === "failed") {
            assert.match(prepared.error, /must use respondWith/);
        }
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

        assert.equal(results.length, 1);
        assert.equal(results[0].requestId, "request-2");
        assert.equal(results[0].status, "success");
        assert.equal(results[0].input.kind, "files");
        assert.equal((results[0].input.files[0] as File).name, "a.jpg");
        assert.deepEqual(results[0].succMap, {"a.jpg": "assets/a.jpg"});
    });

    it("isolates completion results between callbacks", async () => {
        let secondResult: IAssetUploadResult;
        const prepared = await prepareAssetUpload({
            plugins: [
                createPlugin(event => event.detail.onComplete(result => {
                    result.succFiles[0].path = "assets/mutated.jpg";
                    result.succMap["a.jpg"] = "assets/mutated.jpg";
                    assert.equal(result.acceptedInput.kind, "local-files");
                    if (result.acceptedInput.kind === "local-files") {
                        result.acceptedInput.files[0].path = "mutated.jpg";
                    }
                })),
                createPlugin(event => event.detail.onComplete(result => {
                    secondResult = result;
                })),
            ],
            protyle,
            input: {kind: "local-files", files: [{path: "a.jpg", size: 1}]},
            context,
        });

        prepared.task.complete({
            status: "success",
            acceptedInput: {kind: "local-files", files: [{path: "a.jpg", size: 1}]},
            succFiles: [{index: 0, name: "a.jpg", path: "assets/a.jpg"}],
            succMap: {"a.jpg": "assets/a.jpg"},
        });

        assert.equal(secondResult.succFiles[0].path, "assets/a.jpg");
        assert.equal(secondResult.succMap["a.jpg"], "assets/a.jpg");
        assert.equal(secondResult.acceptedInput.kind, "local-files");
        if (secondResult.acceptedInput.kind === "local-files") {
            assert.equal(secondResult.acceptedInput.files[0].path, "a.jpg");
        }
    });

    it("preserves the full input when only an accepted subset is uploaded", async () => {
        const results: IAssetUploadResult[] = [];
        const acceptedFile = createFile("a.jpg");
        const rejectedFile = createFile("b.exe");
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                event.detail.onComplete(result => results.push(result));
                event.detail.respondWith({
                    action: "replace",
                    input: {kind: "files", files: [acceptedFile, rejectedFile]},
                });
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        prepared.task.complete({
            status: "partial",
            acceptedInput: {kind: "files", files: [acceptedFile]},
            rejected: [{index: 1, name: rejectedFile.name, reasons: ["type-not-accepted"]}],
        });

        assert.equal(results[0].input.files.length, 2);
        assert.equal(results[0].acceptedInput.files.length, 1);
        assert.equal(results[0].rejected[0].index, 1);
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

    it("fails closed when a listener throws synchronously", async () => {
        let laterPluginCalled = false;
        const prepared = await prepareAssetUpload({
            plugins: [
                createPlugin(() => {
                    throw new Error("compression crashed");
                }),
                createPlugin(() => {
                    laterPluginCalled = true;
                }),
            ],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "failed");
        assert.equal(laterPluginCalled, false);
        if (prepared.state === "failed") {
            assert.match(prepared.error, /test-plugin.*compression crashed/);
        }
    });

    it("rejects an async listener that does not claim the request synchronously", async () => {
        const originalConsoleError = console.error;
        console.error = () => undefined;
        try {
            const prepared = await prepareAssetUpload({
                plugins: [createPlugin(async event => {
                    await Promise.resolve();
                    event.detail.respondWith({action: "cancel"});
                })],
                protyle,
                input: {kind: "files", files: [createFile("a.png")]},
                context,
            });

            assert.equal(prepared.state, "failed");
            if (prepared.state === "failed") {
                assert.match(prepared.error, /must call respondWith synchronously/);
            }
            await new Promise(resolve => setTimeout(resolve, 0));
        } finally {
            console.error = originalConsoleError;
        }
    });

    it("times out plugin processing and aborts its signal", async () => {
        let signal: AbortSignal;
        const results: IAssetUploadResult[] = [];
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => {
                signal = event.detail.signal;
                event.detail.onComplete(result => results.push(result));
                event.detail.respondWith(new Promise(() => undefined));
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
            timeout: 10,
        });

        assert.equal(prepared.state, "failed");
        assert.equal(signal.aborted, true);
        assert.equal(results[0].status, "failed");
        assert.match(results[0].error, /timed out/);
    });

    it("gives each plugin an independent timeout", async () => {
        const plugins = [createPlugin(event => {
            event.detail.respondWith(new Promise(resolve => setTimeout(() => resolve({
                action: "replace",
                input: {kind: "files", files: [createFile("b.jpg")]},
            }), 15)));
        }), createPlugin(event => {
            event.detail.respondWith(new Promise(resolve => setTimeout(() => resolve({
                action: "replace",
                input: {kind: "files", files: [createFile("c.jpg")]},
            }), 15)));
        })];
        const prepared = await prepareAssetUpload({
            plugins,
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
            timeout: 25,
        });

        assert.equal(prepared.state, "ready");
        assert.equal((prepared.task.input.files[0] as File).name, "c.jpg");
    });

    it("cancels pending processing when the editor is destroyed", async () => {
        let signal: AbortSignal;
        const pending = prepareAssetUpload({
            plugins: [createPlugin(event => {
                signal = event.detail.signal;
                event.detail.respondWith(new Promise(() => undefined));
            })],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        cancelAssetUploads(protyle);
        const prepared = await pending;
        assert.equal(prepared.state, "canceled");
        assert.equal(signal.aborted, true);
    });

    it("aborts the upload phase when the editor is destroyed", async () => {
        const currentProtyle = {} as IProtyle;
        const prepared = await prepareAssetUpload({
            plugins: [],
            protyle: currentProtyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });
        assert.equal(prepared.state, "ready");
        prepared.task.startUpload();

        cancelAssetUploads(currentProtyle);

        assert.equal(prepared.task.signal.aborted, true);
        prepared.task.complete({status: "canceled"});
    });

    it("cancels pending processing when the active plugin is unloaded", async () => {
        let signal: AbortSignal;
        const plugin = createPlugin(event => {
            signal = event.detail.signal;
            event.detail.respondWith(new Promise(() => undefined));
        });
        const pending = prepareAssetUpload({
            plugins: [plugin],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        cancelAssetUploadsByPlugin(plugin);
        const prepared = await pending;
        assert.equal(prepared.state, "canceled");
        assert.equal(signal.aborted, true);
    });

    it("cancels pending processing when a queued plugin is unloaded", async () => {
        const activePlugin = createPlugin(event => {
            event.detail.respondWith(new Promise(() => undefined));
        });
        const queuedPlugin = createPlugin(() => undefined);
        const pending = prepareAssetUpload({
            plugins: [activePlugin, queuedPlugin],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        cancelAssetUploadsByPlugin(queuedPlugin);
        const prepared = await pending;
        assert.equal(prepared.state, "canceled");
    });

    it("does not dispatch a queued plugin unloaded after the active response settles", async () => {
        let resolveDecision: (decision: IAssetUploadDecision) => void;
        let queuedPluginCalled = false;
        const activePlugin = createPlugin(event => event.detail.respondWith(new Promise(resolve => {
            resolveDecision = resolve;
        })));
        const queuedPlugin = createPlugin(() => {
            queuedPluginCalled = true;
        });
        const pending = prepareAssetUpload({
            plugins: [activePlugin, queuedPlugin],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        resolveDecision({action: "replace", input: {kind: "files", files: [createFile("b.jpg")]}});
        queueMicrotask(() => cancelAssetUploadsByPlugin(queuedPlugin));
        const prepared = await pending;

        assert.equal(prepared.state, "canceled");
        assert.equal(queuedPluginCalled, false);
    });

    it("rejects invalid replacement elements with the plugin name and index", async () => {
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => event.detail.respondWith({
                action: "replace",
                input: {kind: "local-files", files: [null]} as unknown as IAssetUploadInput,
            }))],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        assert.equal(prepared.state, "failed");
        if (prepared.state === "failed") {
            assert.match(prepared.error, /test-plugin.*input\.files\[0]/);
        }
    });

    it("requires background replacements to contain exactly one file", async () => {
        const prepared = await prepareAssetUpload({
            plugins: [createPlugin(event => event.detail.respondWith({
                action: "replace",
                input: {kind: "files", files: [createFile("a.jpg"), createFile("b.jpg")]},
            }))],
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context: {source: "file-picker", target: "background"},
        });

        assert.equal(prepared.state, "failed");
        if (prepared.state === "failed") {
            assert.match(prepared.error, /background uploads require exactly one file/);
        }
    });

    it("uses a stable plugin snapshot while awaiting a response", async () => {
        let resolveDecision: (decision: IAssetUploadDecision) => void;
        let laterPluginCalled = false;
        const plugins = [
            createPlugin(event => event.detail.respondWith(new Promise(resolve => {
                resolveDecision = resolve;
            }))),
            createPlugin(() => {
                laterPluginCalled = true;
            }),
        ];
        const pending = prepareAssetUpload({
            plugins,
            protyle,
            input: {kind: "files", files: [createFile("a.png")]},
            context,
        });

        plugins.splice(1, 1);
        resolveDecision({action: "replace", input: {kind: "files", files: [createFile("b.jpg")]}});
        const prepared = await pending;
        assert.equal(prepared.state, "ready");
        assert.equal(laterPluginCalled, true);
    });
});
