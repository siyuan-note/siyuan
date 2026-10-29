import * as assert from "node:assert/strict";
import {test} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../testSupport/loadModule";
import {registerEditorSave, trackEditorSaveRequest} from "./editorSave";

const loadFetch = (fetchImplementation: typeof fetch) => {
    const exports = loadModule<{fetchPost?: (...args: any[]) => Promise<void>, fetchSyncPost?: (...args: any[]) => Promise<unknown>}>(
        "src/util/fetch.ts", {
        require: (name: string) => {
            switch (name) {
                case "./fetchWithAppId": return {fetchWithAppId: fetchImplementation};
                case "../constants": return {Constants: {}};
                case "electron": return {ipcRenderer: {send: () => {}}};
                case "./processMessage": return {processMessage: (response: {code: number}) => response.code >= 0};
                case "./kernelFault": return {kernelError: () => {}};
                case "../dialog/message": return {showMessage: () => {}};
                case "../config/setting/pending": return {trackSettingRequest: (_url: string, promise: Promise<unknown>) => promise};
                case "../protyle/util/editorSave": return {trackEditorSaveRequest};
                case "./fetchTimeout": return {withFetchTimeout: (request: () => Promise<unknown>) => request()};
                default: throw new Error(name);
            }
        },
        FormData,
        window: {siyuan: {languages: {transactionSaveUnconfirmed: "Save unconfirmed"}}},
        console: {warn: () => {}},
    }, ScriptTarget.ES2020);
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

const loadSyncSaves = () => loadModule<Pick<typeof import("./editorSave"),
    "trackEditorSaveRequest" | "flushPendingEditorSaves" | "getEditorSaveFailureVersion" |
    "registerSyncEditorSave" | "disposeSyncEditorSave">>("src/protyle/util/editorSave.ts", {
        window: {siyuan: {languages: {settingsPendingSaveError: "Save failed"}}},
    }, ScriptTarget.ES2020);

test("sync preparation waits for ordinary unregistered editor requests and rejects earlier unconfirmed saves", async () => {
    const saves = loadSyncSaves();
    let complete: (value: unknown) => void;
    saves.trackEditorSaveRequest("/api/transactions", request("main"), new Promise(resolve => complete = resolve));
    let flushed = false;
    const flushing = saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()).then(() => flushed = true);
    await Promise.resolve();
    assert.equal(flushed, false);
    complete(success);
    await flushing;
    await saves.trackEditorSaveRequest("/api/transactions", request("main"), Promise.resolve({code: -1}));
    await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
    await saves.trackEditorSaveRequest("/api/transactions", request("other"), Promise.resolve(success));
    await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
    await saves.trackEditorSaveRequest("/api/transactions", request("main"), Promise.resolve(success));
    await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());
});

test("sync save confirmation preserves structural failures and ignores superseded text failures", async () => {
    const saves = loadSyncSaves();
    let finishOld: (value: unknown) => void;
    const old = saves.trackEditorSaveRequest("/api/transactions", request(), new Promise(resolve => finishOld = resolve));
    await saves.trackEditorSaveRequest("/api/transactions", request(), Promise.resolve(success));
    finishOld({code: -1});
    await old;
    await Promise.resolve();
    await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());
    await saves.trackEditorSaveRequest("/api/transactions", request("drawer", "move"), Promise.resolve({code: -1}));
    await saves.trackEditorSaveRequest("/api/transactions", request(), Promise.resolve(success));
    await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
});

test("closing an editor clears only its failed text and structural saves, including late responses", async () => {
    for (const action of ["update", "move"]) {
        const saves = loadSyncSaves();
        const closed = {id: "closed"} as IProtyle;
        const open = {id: "open"} as IProtyle;
        saves.registerSyncEditorSave(closed);
        saves.registerSyncEditorSave(open);
        await saves.trackEditorSaveRequest("/api/transactions", request(closed.id, action), Promise.resolve({code: -1}));
        await saves.trackEditorSaveRequest("/api/transactions", request(open.id), Promise.resolve({code: -1}));
        saves.disposeSyncEditorSave(closed);
        await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
        await saves.trackEditorSaveRequest("/api/transactions", request(open.id), Promise.resolve(success));
        await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());

        let finish: (value: unknown) => void;
        const pending = saves.trackEditorSaveRequest("/api/transactions", request(open.id, action), new Promise(resolve => finish = resolve));
        const failureVersion = saves.getEditorSaveFailureVersion();
        saves.disposeSyncEditorSave(open);
        finish({code: -1});
        await pending;
        await saves.flushPendingEditorSaves(failureVersion);

        const reopened = {id: "reopened"} as IProtyle;
        saves.registerSyncEditorSave(reopened);
        await saves.trackEditorSaveRequest("/api/transactions", request(reopened.id), Promise.resolve(success));
        await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());
    }
});

test("failed title saves remain protected until the final editor for that document is destroyed", async () => {
    const saves = loadSyncSaves();
    const first = {id: "first", notebookId: "box", path: "/root.sy"} as IProtyle;
    const second = {...first, id: "second"};
    const other = {...first, id: "other", path: "/other.sy"};
    [first, second, other].forEach(saves.registerSyncEditorSave);
    const title = {notebook: "box", path: "/root.sy", title: "unconfirmed"};
    await saves.trackEditorSaveRequest("/api/filetree/renameDoc", title, Promise.resolve({code: -1}));
    saves.disposeSyncEditorSave(first);
    await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
    let finish: (value: unknown) => void;
    const pending = saves.trackEditorSaveRequest("/api/filetree/renameDoc", title, new Promise(resolve => finish = resolve));
    const failureVersion = saves.getEditorSaveFailureVersion();
    saves.disposeSyncEditorSave(second);
    finish({code: -1});
    await pending;
    await saves.flushPendingEditorSaves(failureVersion);
});

test("destroying a moved editor clears title failures associated with its previous path", async () => {
    const saves = loadSyncSaves();
    const protyle = {id: "moved", notebookId: "box", path: "/before.sy"} as IProtyle;
    saves.registerSyncEditorSave(protyle);
    await saves.trackEditorSaveRequest("/api/filetree/renameDoc",
        {notebook: "box", path: protyle.path, title: "unconfirmed"}, Promise.resolve({code: -1}));
    protyle.path = "/parent/before.sy";
    saves.disposeSyncEditorSave(protyle);
    await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());
});

test("editor destruction cancels pending title input and removes its sync save failures", async () => {
    const saves = loadSyncSaves();
    let cancelled = false;
    const noop = () => {};
    const protyle = {id: "destroyed", notebookId: "box", path: "/root.sy",
        title: {cancelPendingInput: () => cancelled = true},
        element: {classList: {remove: noop}, removeAttribute: noop},
    } as unknown as IProtyle;
    saves.registerSyncEditorSave(protyle);
    await saves.trackEditorSaveRequest("/api/transactions", request(protyle.id), Promise.resolve({code: -1}));
    await assert.rejects(saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion()), /Save failed/);
    const exports = loadModule<Pick<typeof import("./destroy"), "destroy">>("src/protyle/util/destroy.ts", {
        require: (name: string) => name === "./editorSave" ? saves : new Proxy({}, {get: () => noop}),
    }, ScriptTarget.ES2020);
    exports.destroy(protyle);
    assert.equal(cancelled, true);
    await saves.flushPendingEditorSaves(saves.getEditorSaveFailureVersion());
});

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
    const exports = loadModule<{Title?: {prototype: any}}>("src/protyle/header/Title.ts", {
        require: (name: string) => {
            if (name === "../../util/fetch") return {fetchPost: (_url: string, data: unknown) => requests.push(data)};
            if (name === "../../editor/rename") return {validateName: () => true, normalizeDocumentTitle: (name: string) => name};
            if (name === "../../dialog/tooltip") return {hideTooltip: () => {}};
            if (name === "../../constants") return {Constants: {TIMEOUT_INPUT: 400}};
            return {};
        },
        window: {setTimeout: (callback: () => void) => {timers.set(++nextTimer, callback); return nextTimer;}},
        clearTimeout: (timer: number) => timers.delete(timer),
    }, ScriptTarget.ES2020);
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
