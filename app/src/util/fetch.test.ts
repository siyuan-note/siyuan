import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {withFetchTimeout} from "./fetchTimeout";
import {flushSettingSaves, settingSaveFailures, trackSettingRequest} from "../config/setting/pending";
import {trackEditorSaveRequest} from "../protyle/util/editorSave";

const loadFetchPost = (fetchImplementation: typeof fetch = () => new Promise(() => {}),
                       processResponse: (response: IWebSocketData) => boolean = () => true,
                       templateRequest?: {signal: AbortSignal; headers: Record<string, string>; isCurrent: () => boolean; finish: () => void}, interactive = false) => {
    const sends: unknown[][] = [];
    const timeouts: number[] = [];
    const notifications: unknown[][] = [];
    const scheduled: unknown[][] = [];
    let kernelChecks = 0;
    const exports: {
        fetchPost?: (...args: any[]) => Promise<void>;
        fetchSyncPost?: (...args: any[]) => Promise<IWebSocketData>;
    } = {};
    const source = ts.transpileModule(readFileSync(join(__dirname, "fetch.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(source, {
        exports,
        require: (name: string) => {
            switch (name) {
                case "./fetchWithAppId": return {fetchWithAppId: fetchImplementation};
                case "../template/http": return {beginTemplateHTTPRequest: () => templateRequest,
                    getTemplateHTTPWindow: () => ({app: "app", session: "main"})};
                case "../protyle/render/av/automaticHTTP": return {scheduleAutomaticHTTP: (jobs: unknown[]) => scheduled.push(jobs)};
                case "../constants": return {Constants: {SIYUAN_QUIT: "quit"}};
                case "electron": return {ipcRenderer: {send: (...args: unknown[]) => sends.push(args)}};
                case "./processMessage": return {processMessage: processResponse};
                case "./kernelFault": return {kernelError: () => { kernelChecks++; }};
                case "../dialog/message": return {showMessage: (...args: unknown[]) => notifications.push(args)};
                case "../config/setting/pending": return {trackSettingRequest};
                case "../protyle/util/editorSave": return {trackEditorSaveRequest};
                case "./fetchTimeout": return {
                    withFetchTimeout: (request: (signal?: AbortSignal) => Promise<unknown>, signal: AbortSignal, timeout: number) => {
                        timeouts.push(timeout);
                        return withFetchTimeout(request, signal, timeout > 0 ? 10 : 0);
                    },
                };
                default: throw new Error(name);
            }
        },
        fetch: fetchImplementation,
        FormData,
        location: {port: "6806"},
        console: {warn: () => {}},
        window: {siyuan: {ws: interactive ? {ws: {}} : undefined, languages: {transactionSaveUnconfirmed: "Save unconfirmed"}}},
    });
    return {fetchPost: exports.fetchPost, fetchSyncPost: exports.fetchSyncPost, sends, timeouts, notifications, scheduled,
        kernelChecks: () => kernelChecks};
};

it("editing transport attaches the live main window and schedules HTTP only after acknowledging the save", async () => {
    const job = {id: "task", avID: "database", blockID: "carrier", sequence: 1};
    const state = loadFetchPost(async (_url, options) => {
        const headers = new Headers(options.headers);
        assert.equal(headers.get("X-Siyuan-Template-App"), "app");
        assert.equal(headers.get("X-Siyuan-Template-Session"), "main");
        assert.equal(headers.get("X-Siyuan-Template-Execution"), null);
        return new Response(JSON.stringify({code: 0, msg: "", data: [{doOperations: [], httpAutomationJobs: [job]}]}),
            {headers: {"Content-Type": "application/json"}});
    }, () => true, undefined, true);
    let saved = false;
    await state.fetchPost("/api/transactions", {transactions: []}, () => {
        assert.equal(state.scheduled.length, 0);
        saved = true;
    });
    assert.equal(saved, true);
    assert.deepEqual(state.scheduled, [[job]]);
});

it("invokes the failure callback once when a request stalls", async () => {
    const {fetchPost, sends} = loadFetchPost();
    let failures = 0;
    await fetchPost("/api/bazaar/getInstalledPlugin", {}, () => assert.fail("unexpected success"),
        undefined, (response: {code: number}) => {
            failures++;
            assert.equal(response.code, 400);
        }, undefined, 30000);
    assert.equal(failures, 1);
    assert.equal(sends.length, 0);
});

it("checks template ownership synchronously before callbacks and sync response consumers", async () => {
    for (const mode of ["callback", "sync"]) {
        const controller = new AbortController();
        let checks = 0;
        let finished = 0;
        const state = loadFetchPost(async () => new Response(JSON.stringify({code: 0, msg: "", data: {content: "old"}}), {
            headers: {"Content-Type": "application/json"},
        }), () => true, {signal: controller.signal, headers: {}, isCurrent: () => {
            checks++;
            controller.abort();
            return false;
        }, finish: () => {finished++;}});
        if (mode === "callback") {
            await state.fetchPost("/api/template/render", {id: "old"}, () => assert.fail("obsolete response applied"));
        } else {
            const response = await state.fetchSyncPost("/api/av/renderAttributeView", {id: "old"});
            assert.equal(response.code, -1);
            assert.equal(response.data, null);
        }
        assert.equal(checks, 1);
        assert.equal(finished, 1);
        assert.equal(controller.signal.aborted, true);
    }
});

it("manual automation transport carries confirmation identity and releases the execution", async () => {
    const controller = new AbortController();
    let finished = 0;
    const headers = {"X-Siyuan-Template-Execution": "manual-execution"};
    const state = loadFetchPost(async (url, options) => {
        assert.equal(url, "/api/av/runAttributeViewAutomation");
        assert.equal(options.headers, headers);
        assert.equal(options.signal, controller.signal);
        return new Response(JSON.stringify({code: 0, msg: "", data: null}));
    }, () => true, {signal: controller.signal, headers, isCurrent: () => true, finish: () => {finished++;}});
    const response = await state.fetchSyncPost("/api/av/runAttributeViewAutomation", {
        avID: "database", blockID: "carrier", ruleID: "rule",
    }, undefined, false, controller.signal);
    assert.equal(response.code, 0);
    assert.equal(finished, 1);
});

it("keeps positive business errors in the callback and filters negative errors", async () => {
    for (const code of [-1, 0, 3]) {
        const payload = {code, msg: "message", data: code === 0 ? {rootID: "id"} : "indexing"};
        const {fetchPost} = loadFetchPost(async () => new Response(JSON.stringify(payload), {
            headers: {"Content-Type": "application/json"},
        }), response => response.code >= 0);
        const received: IWebSocketData[] = [];
        await fetchPost("/api/block/getBlockInfo", {id: "id"}, (response: IWebSocketData) => received.push(response));
        assert.deepEqual(received, code < 0 ? [] : [payload]);
    }
});

it("keeps asynchronous error responses and the process option", async () => {
    const payload = {code: -1, msg: "readonly", data: {closeTimeout: 5000}};
    let processed = 0;
    const {fetchSyncPost} = loadFetchPost(async () => new Response(JSON.stringify(payload)), () => {
        processed++;
        return false;
    });
    assert.deepEqual(await fetchSyncPost("/api/attr/setBlockAttrs", {id: "id", attrs: {}}), payload);
    assert.equal(processed, 1);
    assert.deepEqual(await fetchSyncPost("/api/attr/setBlockAttrs", {id: "id", attrs: {}}, undefined, false), payload);
    assert.equal(processed, 1);
});

it("preserves notification-only RPC responses as empty callback text", async () => {
    const {fetchPost} = loadFetchPost(async () => new Response(null, {status: 204}));
    let received: unknown;
    await fetchPost("/api/plugin/rpc", {jsonrpc: "2.0", method: "notify"}, (response: unknown) => received = response);
    assert.equal(received, "");
});

it("preserves raw file text and routes HTTP 202 file errors to the failure callback", async () => {
    const text = "file content";
    const raw = loadFetchPost(async () => new Response(text, {headers: {"Content-Type": "text/plain"}}));
    let received: unknown;
    await raw.fetchPost("/api/file/getFile", {path: "file.txt"}, (response: unknown) => received = response);
    assert.equal(received, text);

    const failure: IWebSocketData = {code: -1, msg: "missing file", data: null};
    const missing = loadFetchPost(async () => new Response(JSON.stringify(failure), {
        status: 202,
        headers: {"Content-Type": "application/json"},
    }));
    await missing.fetchPost("/api/file/getFile", {path: "missing"}, () => assert.fail("unexpected success"), undefined,
        (response: unknown) => received = response);
    assert.deepEqual(received, failure);
});

it("preserves FormData request bodies for upload endpoints", async () => {
    const body = new FormData();
    body.append("path", "file.txt");
    const {fetchPost} = loadFetchPost(async (_url, options) => {
        assert.equal(options.body, body);
        return new Response(JSON.stringify({code: 0, msg: "", data: null}), {headers: {"Content-Type": "application/json"}});
    });
    await fetchPost("/api/file/putFile", body);
});

it("keeps the desktop alive when an exit request stalls", async () => {
    const {fetchPost, sends} = loadFetchPost();
    await fetchPost("/api/system/exit", {}, () => assert.fail("unexpected success"));
    assert.deepEqual(sends, []);
});

it("retains the existing fallback for closing layout and workspace requests", async () => {
    for (const url of ["/api/system/setUILayout", "/api/system/setWorkspaceDir"]) {
        const {fetchPost, sends, timeouts} = loadFetchPost();
        await fetchPost(url, {errorExit: true}, () => assert.fail("unexpected success"));
        assert.deepEqual(timeouts, [30000]);
        assert.deepEqual(sends, [["quit", "6806"]]);
    }
});

it("reports consumed settings errors to reset without changing fetch callbacks", async () => {
    for (const response of ["business", "network"]) {
        const before = settingSaveFailures();
        const {fetchPost} = loadFetchPost(async () => {
            if (response === "network") throw new Error("offline");
            return new Response(JSON.stringify({code: -1, msg: "failed", data: null}), {
                headers: {"Content-Type": "application/json"},
            });
        }, () => false);
        await fetchPost("/api/setting/patch", {});
        await assert.rejects(flushSettingSaves(before));
    }
});

it("lost transaction responses warn without replaying writes or reporting success", async () => {
    for (const method of ["fetchPost", "fetchSyncPost"] as const) {
        for (const action of ["update", "insert", "create"]) {
            let applied = 0;
            const state = loadFetchPost(async () => {
                applied++;
                throw new TypeError("Failed to fetch");
            });
            const request = {session: "editor", transactions: [{doOperations: [{action, id: "block"}]}]};
            if (method === "fetchSyncPost") {
                await assert.rejects(state.fetchSyncPost("/api/transactions", request), /Failed to fetch/);
            } else {
                let failed = 0;
                await state.fetchPost("/api/transactions", request, () => assert.fail("unexpected success"), undefined,
                    () => { failed++; });
                assert.equal(failed, 1);
            }
            assert.equal(applied, 1, `${method}: ${action}`);
            assert.deepEqual(state.notifications, [["Save unconfirmed", 0, "error", "transaction-save-unconfirmed"]]);
            assert.equal(state.kernelChecks(), 1);
        }
    }
});

it("truncated transaction responses are visible while cancellation and callback errors do not diagnose the kernel", async () => {
    const truncated = loadFetchPost(async () => new Response("{", {headers: {"Content-Type": "application/json"}}));
    await truncated.fetchPost("/api/transactions", {});
    assert.equal(truncated.notifications.length, 1);
    assert.equal(truncated.kernelChecks(), 1);
    const cancelled = loadFetchPost(async () => { throw new DOMException("Cancelled", "AbortError"); });
    await cancelled.fetchPost("/api/transactions", {});
    assert.equal(cancelled.notifications.length, 0);
    assert.equal(cancelled.kernelChecks(), 0);
    const callback = loadFetchPost(async () => new Response('{"code":0,"data":[]}', {
        headers: {"Content-Type": "application/json"},
    }));
    await callback.fetchPost("/api/transactions", {}, () => { throw new TypeError("Failed to fetch"); });
    assert.equal(callback.notifications.length, 0);
    assert.equal(callback.kernelChecks(), 0);
});
