import * as assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {registerEditorSave, trackEditorSaveRequest} from "./editorSave";

const source = (path: string) => ts.transpileModule(readFileSync(join(__dirname, path), "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
}).outputText;

const loadFetch = (fetchImplementation: typeof fetch) => {
    const exports: {fetchPost?: (...args: any[]) => Promise<void>, fetchSyncPost?: (...args: any[]) => Promise<unknown>} = {};
    runInNewContext(source("../../util/fetch.ts"), {
        exports,
        require: (name: string) => {
            switch (name) {
                case "./fetchWithAppId": return {fetchWithAppId: fetchImplementation};
                case "../constants": return {Constants: {}};
                case "electron": return {ipcRenderer: {send: () => {}}};
                case "./processMessage": return {processMessage: (response: {code: number}) => response.code >= 0};
                case "./kernelFault": return {kernelError: () => {}};
                case "../config/setting/pending": return {trackSettingRequest: (_url: string, promise: Promise<unknown>) => promise};
                case "../protyle/util/editorSave": return {trackEditorSaveRequest};
                case "./fetchTimeout": return {withFetchTimeout: (request: () => Promise<unknown>) => request()};
                default: throw new Error(name);
            }
        },
        FormData,
        window: {siyuan: {}},
        console: {warn: () => {}},
    });
    return exports;
};

const editor = () => {
    Object.assign(globalThis, {window: {siyuan: {languages: {settingsPendingSaveError: "Save failed"}}}});
    return {id: "drawer", path: "/root.sy", notebookId: "box"} as IProtyle;
};
const request = (session = "drawer", action = "update", id = "block") => ({
    session,
    transactions: [{doOperations: [{action, id, data: "<div>latest content</div>"}]}],
});
const success = {code: 0, data: [{doOperations: [{action: "update"}]}]};
const response = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});

test("tracks actual fetchPost business, network, HTTP and malformed save failures despite swallowed errors", async () => {
    for (const failure of ["negative", "positive", "network", "http", "missing-result", "missing-operations"]) {
        const guard = registerEditorSave(editor());
        try {
            const {fetchPost} = loadFetch(async () => {
                if (failure === "network") throw new Error("Failed to fetch");
                if (failure === "http") return new Response(null, {status: 403});
                if (failure === "missing-result") return response({code: 0, data: []});
                if (failure === "missing-operations") return response({code: 0, data: [{}]});
                return response({code: failure === "positive" ? 1 : -1, data: null});
            });
            await fetchPost("/api/transactions", request());
            await assert.rejects(guard.flush(), /Save failed/, failure);
        } finally {
            guard.dispose();
        }
    }
});

test("waits for an actual pending successful transaction response", async () => {
    const guard = registerEditorSave(editor());
    let finish: (value: Response) => void;
    const {fetchPost} = loadFetch(() => new Promise(resolve => finish = resolve));
    const saving = fetchPost("/api/transactions", request());
    let flushed = false;
    const flushing = guard.flush().then(() => flushed = true);
    await Promise.resolve();
    assert.equal(flushed, false);
    finish(response(success));
    await Promise.all([saving, flushing]);
    assert.equal(flushed, true);
    guard.dispose();
});

test("only watches registered sessions and matching notebook/path title saves", async () => {
    const guard = registerEditorSave(editor());
    const {fetchPost} = loadFetch(async () => response({code: -1, data: null}));
    try {
        await fetchPost("/api/transactions", request("main"));
        await fetchPost("/api/filetree/renameDoc", {notebook: "other", path: "/root.sy", title: "title"});
        await fetchPost("/api/filetree/renameDoc", {notebook: "box", path: "/other.sy", title: "title"});
        await guard.flush();
        await fetchPost("/api/filetree/renameDoc", {notebook: "box", path: "/root.sy", title: "title"});
        await assert.rejects(guard.flush(), /Save failed/);
    } finally {
        guard.dispose();
    }
});

test("fetchSyncPost failures are observed before response handling", async () => {
    const guard = registerEditorSave(editor());
    const {fetchSyncPost} = loadFetch(async () => response({code: -1, data: null}));
    try {
        await fetchSyncPost("/api/transactions", request());
        await assert.rejects(guard.flush(), /Save failed/);
    } finally {
        guard.dispose();
    }
});

test("only a later successful full update of the same block clears its earlier failed update", async () => {
    const guard = registerEditorSave(editor());
    let payload: unknown = {code: -1, data: null};
    const {fetchPost} = loadFetch(async () => response(payload));
    try {
        await fetchPost("/api/transactions", request());
        payload = success;
        await fetchPost("/api/transactions", request("drawer", "update", "other-block"));
        await assert.rejects(guard.flush(), /Save failed/);
        await fetchPost("/api/transactions", request());
        await guard.flush();
    } finally {
        guard.dispose();
    }
});

test("later title saves can resolve failed renames without replaying any request", async () => {
    const guard = registerEditorSave(editor());
    let failed = true;
    let requests = 0;
    const {fetchPost} = loadFetch(async () => {
        requests++;
        return response({code: failed ? -1 : 0, data: null});
    });
    try {
        const rename = {notebook: "box", path: "/root.sy", title: "latest title"};
        await fetchPost("/api/filetree/renameDoc", rename);
        await assert.rejects(guard.flush(), /Save failed/);
        failed = false;
        await fetchPost("/api/filetree/renameDoc", rename);
        await guard.flush();
        assert.equal(requests, 2);
    } finally {
        guard.dispose();
    }
});

test("ambiguous structural failures stay blocked after later successful edits and are never replayed", async () => {
    const guard = registerEditorSave(editor());
    let failed = true;
    let requests = 0;
    const {fetchPost} = loadFetch(async () => {
        requests++;
        if (failed) throw new Error("offline");
        return response(success);
    });
    try {
        await fetchPost("/api/transactions", request("drawer", "insert"));
        failed = false;
        await fetchPost("/api/transactions", request());
        await assert.rejects(guard.flush(), /Save failed/);
        await assert.rejects(guard.flush(), /Save failed/);
        assert.equal(requests, 2);
    } finally {
        guard.dispose();
    }
});

test("disposal drops failure state and ignores late requests after lock or destruction", async () => {
    const guard = registerEditorSave(editor());
    let finish: (value: Response) => void;
    const {fetchPost} = loadFetch(() => new Promise(resolve => finish = resolve));
    const saving = fetchPost("/api/transactions", request());
    guard.dispose();
    finish(response({code: -1, data: null}));
    await saving;
    await guard.flush();
});

test("Title flushes debounce once, captures composition, and can cancel pending saves", () => {
    let nextTimer = 0;
    const timers = new Map<number, () => void>();
    const requests: unknown[] = [];
    const exports: {Title?: {prototype: any}} = {};
    runInNewContext(source("../header/Title.ts"), {
        exports,
        require: (name: string) => {
            if (name === "../../util/fetch") return {fetchPost: (_url: string, data: unknown) => requests.push(data)};
            if (name === "../../editor/rename") return {validateName: () => true, replaceFileName: (name: string) => name};
            if (name === "../../dialog/tooltip") return {hideTooltip: () => {}};
            if (name === "../../constants") return {Constants: {TIMEOUT_INPUT: 400}};
            return {};
        },
        window: {setTimeout: (callback: () => void) => {timers.set(++nextTimer, callback); return nextTimer;}},
        clearTimeout: (timer: number) => timers.delete(timer),
    });
    const title = Object.create(exports.Title.prototype);
    const protyle = editor();
    title.protyle = protyle;
    title.editElement = {textContent: "new title"};
    title.rename(protyle);
    assert.equal(timers.size, 1);
    title.flushPendingInput();
    title.flushPendingInput();
    assert.equal(timers.size, 0);
    assert.equal(requests.length, 1);
    title.editElement.textContent = "composing title";
    title.composing = true;
    title.flushPendingInput();
    assert.equal(requests.length, 2);
    assert.equal((requests[1] as {title: string}).title, "composing title");
    title.rename(protyle);
    title.cancelPendingInput();
    title.flushPendingInput();
    assert.equal(timers.size, 0);
    assert.equal(requests.length, 2);
});
