import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {SIYUAN_APP_ID_HEADER, withAPIAppId} from "./fetchAppId";
import {ContractFormData} from "./contractFormData";
import {trackEditorSaveRequest} from "../protyle/util/editorSave";

const load = (path: string, globals: Record<string, unknown>, dependencies: Record<string, unknown>) => {
    const exports = {};
    const compiled = transpileModule(readFileSync(path, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(compiled, {...globals, exports, require: (name: string) => {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
    }});
    return exports;
};

const fixture = () => {
    const calls: Array<{input: RequestInfo | URL; init?: RequestInit}> = [];
    const response = new Response('{"code":0,"data":null,"msg":""}', {
        headers: {"Content-Type": "application/json"},
    });
    const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({input, init});
        return Promise.resolve(response);
    };
    const document = {baseURI: "https://siyuan.test/stage/build/app/"};
    const location = {origin: "https://siyuan.test"};
    const {fetchWithAppId} = load("src/util/fetchWithAppId.ts", {fetch, document, location}, {
        "../constants": {Constants: {SIYUAN_APPID: "window-id"}},
        "./fetchAppId": {withAPIAppId},
    }) as typeof import("./fetchWithAppId");
    return {calls, response, fetchWithAppId};
};

test("host fetch preserves input, response and abort signal, including SSE", async () => {
    const {calls, response, fetchWithAppId} = fixture();
    const input = new URL("https://siyuan.test/api/ai/editor/chat");
    const signal = new AbortController().signal;
    const init = Object.freeze({method: "POST", signal, headers: {Accept: "text/event-stream"}, body: "{}"});
    assert.equal(await fetchWithAppId(input, init), response);
    assert.equal(calls[0].input, input);
    assert.equal(calls[0].init.signal, signal);
    assert.equal(calls[0].init.body, "{}");
    assert.equal(new Headers(calls[0].init.headers).get("Accept"), "text/event-stream");
    assert.equal(new Headers(calls[0].init.headers).get(SIYUAN_APP_ID_HEADER), "window-id");
    assert.equal(new Headers(init.headers).has(SIYUAN_APP_ID_HEADER), false);
});

test("shared fetch helpers attach the caller and preserve payloads", async () => {
    for (const method of ["fetchPost", "fetchSyncPost", "fetchGet"] as const) {
        const {calls, fetchWithAppId} = fixture();
        const api = load("src/util/fetch.ts", {FormData, console, setTimeout}, {
            "./fetchWithAppId": {fetchWithAppId},
            "../constants": {Constants: {}},
            electron: {ipcRenderer: {}},
            "./processMessage": {processMessage: () => true},
            "./kernelFault": {kernelError: () => assert.fail("Unexpected kernel error")},
            "./fetchTimeout": {withFetchTimeout: (run: (signal: AbortSignal) => unknown, signal: AbortSignal) => run(signal)},
            "../config/setting/pending": {trackSettingRequest: (_url: string, promise: Promise<unknown>) => promise},
            "../protyle/util/editorSave": {trackEditorSaveRequest},
        }) as typeof import("./fetch");
        const signal = new AbortController().signal;
        const headers = Object.freeze({Authorization: "Token test"});
        if (method === "fetchGet") {
            await new Promise<void>(resolve => api.fetchGet("/api/test", () => resolve()));
            assert.equal(calls[0].init.cache, "no-store");
        } else {
            const data = new ContractFormData({path: "test.txt", file: new Blob(["test"])});
            if (method === "fetchPost") {
                await api.fetchPost("/api/file/putFile", data, undefined, headers, undefined, signal);
            } else {
                await api.fetchSyncPost("/api/file/putFile", data, headers, false, signal);
            }
            assert.equal(calls[0].init.body, data);
            assert.equal(calls[0].init.signal, signal);
            assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Token test");
            assert.equal(new Headers(calls[0].init.headers).has("Content-Type"), false);
        }
        assert.equal(new Headers(calls[0].init.headers).get(SIYUAN_APP_ID_HEADER), "window-id");
    }
});

test("host API paths use scoped fetch, including dynamic RPC and clipboard URLs", () => {
    const paths = ["ai/editorSSE.ts", "layout/dock/agent/agentSSE.ts", "layout/dock/agent/AgentChat.ts",
        "config/tabs/accessTab.ts", "protyle/util/compatibility.ts", "protyle/util/richClipboard.ts", "plugin/kernel.ts"];
    for (const path of paths) {
        const source = readFileSync(`src/${path}`, "utf8");
        assert.match(source, /import \{fetchWithAppId\} from /, path);
        assert.match(source, /fetchWithAppId\(/, path);
        assert.doesNotMatch(source, /\bfetch\(/, path);
    }
    const upload = readFileSync("src/protyle/upload/index.ts", "utf8");
    assert.match(upload, /if \(isSameOriginAPIRequest\(protyle.options.upload.url, document.baseURI, location.origin\)\) \{\s*xhr.setRequestHeader\(SIYUAN_APP_ID_HEADER, Constants.SIYUAN_APPID\);/);
});
