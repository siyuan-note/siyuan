import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {withFetchTimeout} from "./fetchTimeout";

const loadFetchPost = (fetchImplementation: typeof fetch = () => new Promise(() => {}),
                       processResponse: (response: IWebSocketData) => boolean = () => true) => {
    const sends: unknown[][] = [];
    const timeouts: number[] = [];
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
                case "../constants": return {Constants: {SIYUAN_QUIT: "quit"}};
                case "electron": return {ipcRenderer: {send: (...args: unknown[]) => sends.push(args)}};
                case "./processMessage": return {processMessage: processResponse};
                case "./kernelFault": return {kernelError: () => assert.fail("unexpected kernel error")};
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
    });
    return {fetchPost: exports.fetchPost, fetchSyncPost: exports.fetchSyncPost, sends, timeouts};
};

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

it("preserves FormData request bodies for unmigrated upload endpoints", async () => {
    const body = new FormData();
    body.append("path", "file.txt");
    const {fetchPost} = loadFetchPost(async (_url, options) => {
        assert.equal(options.body, body);
        return new Response(JSON.stringify({code: 0, msg: "", data: null}), {headers: {"Content-Type": "application/json"}});
    });
    await fetchPost("/api/file/putFile", body);
});

it("falls back to desktop quit when exit or closing layout requests stall", async () => {
    for (const url of ["/api/system/exit", "/api/system/setUILayout", "/api/system/setWorkspaceDir"]) {
        const {fetchPost, sends, timeouts} = loadFetchPost();
        await fetchPost(url, {errorExit: true}, () => assert.fail("unexpected success"));
        assert.deepEqual(timeouts, [30000]);
        assert.deepEqual(sends, [["quit", "6806"]]);
    }
});
