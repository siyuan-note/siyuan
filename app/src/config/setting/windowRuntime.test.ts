import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/setting/windowRuntime.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const deferred = () => {
    let resolve: (value?: unknown) => void;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
};
const tick = () => new Promise(resolve => setImmediate(resolve));

const fixture = (deferSnippetScripts = false) => {
    let active = true;
    let notebooks: () => Promise<unknown> = async () => {};
    let fetch: (url: string) => Promise<unknown> = async url => url.endsWith("getConf") ?
        {code: 0, data: {conf: {snippet: {enabledCSS: true, enabledJS: true}}}} : {code: 0, data: {zoom: 1.25}};
    const calls: {type: string; value?: unknown}[] = [];
    const guards: (() => boolean)[] = [];
    const scriptModes: boolean[] = [];
    const storage: Record<string, unknown> = {zoom: 1};
    const config = {snippet: {enabledCSS: true, enabledJS: false}, appearance: {hideToolbar: true}};
    const window = {siyuan: {storage, config, notebooks: [{id: "a", name: "Renamed", closed: false}],
        languages: {allNotebooks: "All notebooks"}}, opener: undefined as unknown};
    const elements = new Map();
    const dependencies = {
        Constants: {LOCAL_ZOOM: "zoom", SIYUAN_CMD: "cmd", TIMEOUT_SNIPPET_LOAD: 5000,
            SIZE_ZOOM: [{zoom: 1, position: {x: 8, y: 8}}, {zoom: 1.25, position: {x: 18, y: 12}}]},
        ipcRenderer: {send: (_channel: string, data: unknown) => calls.push({type: "position", value: data})},
        webFrame: {setZoomFactor: (value: number) => calls.push({type: "zoom", value})},
        setToolbarLeftMac: (value: number) => calls.push({type: "left", value}),
        isMac: () => true,
        setNoteBook: async (callback: () => void) => { calls.push({type: "notebooks"}); await notebooks(); callback(); },
        fetchSyncPost: (url: string) => { calls.push({type: "fetch", value: url}); return fetch(url); },
        renderSnippet: async (_timeout: number, guard: () => boolean, beforeJS: () => Promise<void>, includeJS: boolean) => {
            scriptModes.push(includeJS);
            if (includeJS && config.snippet.enabledJS) await beforeJS();
            calls.push({type: "snippet", value: config.snippet}); guards.push(guard);
        },
        getHostCapabilities: () => ({customAppearance: true}),
        ensureLute: async () => { calls.push({type: "lute"}); },
        onAgentStreamingMarkdownStorageChanged: (key: string) => calls.push({type: "storage", value: key}),
        genNotebookOption: (id: string, _box: string, shorthand: boolean, filter: (notebook: unknown) => boolean) => {
            calls.push({type: "options", value: {id, shorthand, filter}});
            return '<option value="">Current</option><option value="a">Renamed</option>';
        },
    };
    const exports = {} as typeof import("./windowRuntime");
    const location = {search: "?settingsWindowToken=token", origin: "https://siyuan"};
    runInNewContext(compiled, {exports, window, location, URLSearchParams, console, setTimeout, clearTimeout,
        CustomEvent: class {constructor(public type: string, public options: unknown) {}},
        document: {getElementById: (id: string) => elements.get(id), createElement: () => ({}),
            querySelectorAll: () => elements.has("history") ? [elements.get("history")] : []},
        require: () => dependencies});
    const runtime = exports.createSettingsWindowRuntime(() => active, deferSnippetScripts);
    return {runtime, exports, calls, guards, scriptModes, config, storage, window, location, elements,
        setActive: (value: boolean) => { active = value; },
        setNotebooks: (value: typeof notebooks) => { notebooks = value; },
        setFetch: (value: typeof fetch) => { fetch = value; }};
};

test("startup snippet refreshes and configuration messages defer Lute until the window is shown", async () => {
    const f = fixture(true);
    f.config.snippet.enabledJS = true;
    await f.runtime.refreshSnippets();
    f.runtime.handleMessage({cmd: "setSnippet", data: {enabledCSS: true, enabledJS: true}} as IWebSocketData);
    await tick();
    await f.runtime.reconnect();
    assert.deepEqual(f.scriptModes, [false, false, false]);
    assert.equal(f.calls.some(call => call.type === "lute"), false);
    await f.runtime.enableSnippetScripts();
    assert.deepEqual(f.scriptModes, [false, false, false, true]);
    assert.equal(f.calls.filter(call => call.type === "lute").length, 1);
    await f.runtime.enableSnippetScripts();
    assert.equal(f.scriptModes.length, 4);
});

test("deferred snippet scripts stay disabled when the owner has been disposed", async () => {
    const f = fixture(true);
    f.setActive(false);
    await f.runtime.enableSnippetScripts();
    assert.equal(f.scriptModes.length, 0);
});

test("settings host handshake fails closed for missing, stale, asynchronous and cross-origin owners", () => {
    const f = fixture();
    const host = {isActive: () => true};
    let late: (value: unknown) => void;
    f.window.opener = {location: {origin: f.location.origin}, dispatchEvent: (event: {options: {detail: typeof late}}) => {
        late = event.options.detail;
    }};
    assert.equal(f.exports.resolveSettingsWindowHost(), undefined);
    late(host);
    f.window.opener = {location: {origin: f.location.origin}, dispatchEvent: (event: {options: {detail: typeof late}}) => {
        event.options.detail(host);
    }};
    assert.equal(f.exports.resolveSettingsWindowHost(), host);
    f.window.opener = {location: {origin: "https://other"}};
    assert.equal(f.exports.resolveSettingsWindowHost(), undefined);
    f.location.search = "";
    assert.equal(f.exports.resolveSettingsWindowHost(), undefined);
});

test("main notebook mutations coalesce serial refreshes and ignore filetree-only commands", async () => {
    const f = fixture();
    const first = deferred();
    f.setNotebooks(() => first.promise);
    const initial = f.runtime.refreshNotebooks();
    for (const cmd of ["createnotebook", "renamenotebook", "mount", "closeBox", "removeBox", "syncMergeResult", "notebookSortChanged"]) {
        assert.equal(f.runtime.handleMessage({cmd} as IWebSocketData), true);
    }
    assert.equal(f.runtime.handleMessage({cmd: "reloadFiletree"} as IWebSocketData), false);
    assert.equal(f.runtime.handleMessage({cmd: "reloadNotebookInfo"} as IWebSocketData), false);
    assert.equal(f.calls.filter(call => call.type === "notebooks").length, 1);
    f.setNotebooks(async () => {});
    first.resolve();
    await initial;
    assert.equal(f.calls.filter(call => call.type === "notebooks").length, 2);
    f.setActive(false);
    await f.runtime.refreshNotebooks();
    assert.equal(f.calls.filter(call => call.type === "notebooks").length, 2);
});

test("notebook options preserve a renamed or removed selection without replacing inputs or filters", () => {
    const f = fixture();
    const select = (value: string) => ({
        value, selectedOptions: [{textContent: "Old name"}], options: [] as {value: string; disabled?: boolean}[],
        set innerHTML(_html: string) { this.options = [{value: ""}, {value: "a"}]; },
        append(option: {value: string}) { this.options.push(option); },
        replaceChildren(...options: {value: string}[]) { this.options = options; },
    });
    const renamed = select("a");
    const removed = select("removed");
    const shorthand = select("a");
    f.elements.set("fileTree.docCreateSaveBox", renamed);
    f.elements.set("fileTree.refCreateSaveBox", removed);
    f.elements.set("fileTree.shorthandSaveBox", shorthand);
    const history = select("a");
    f.elements.set("history", history);
    const input = {value: "unsaved/path"};
    const search = {value: "filtered"};
    f.elements.set("fileTree.docCreateSavePath", input);
    f.elements.set("settingsSearch", search);
    f.exports.patchSettingsNotebookOptions();
    assert.equal(renamed.value, "a");
    assert.equal(removed.value, "removed");
    assert.equal(removed.options.at(-1).disabled, true);
    assert.equal(input.value, "unsaved/path");
    assert.equal(search.value, "filtered");
    assert.equal(history.value, "a");
    assert.deepEqual(history.options.map(option => option.value), ["%", "a"]);
    const options = f.calls.filter(call => call.type === "options");
    const filter = (options[2].value as {filter: (notebook: unknown) => boolean}).filter;
    assert.equal(filter({closed: false, encrypted: false}), true);
    assert.equal(filter({closed: true, encrypted: false}), false);
    assert.equal(filter({closed: false, encrypted: true}), false);
});

test("stalled or failed initialization closes through the failure callback exactly once", async () => {
    const f = fixture();
    const stalled = deferred();
    const errors: unknown[] = [];
    await f.exports.startSettingsWindow(() => stalled.promise as Promise<void>, error => errors.push(error), 1);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /timed out/);
    stalled.resolve();
    await tick();
    assert.equal(errors.length, 1);
    await f.exports.startSettingsWindow(async () => { throw new Error("render failure"); }, error => errors.push(error));
    assert.equal(errors.length, 2);
    assert.match(String(errors[1]), /render failure/);
});

test("settings receive all zoom storage messages without persistence or owner toolbar offsets", () => {
    const f = fixture();
    const send = (cmd: string, data: unknown) => f.runtime.handleMessage({cmd, data} as IWebSocketData);
    f.runtime.applyZoom();
    send("setLocalStorageVal", {key: "zoom", val: 1.25});
    send("removeLocalStorageVal", {key: "zoom"});
    send("setLocalStorageVals", {keyVals: {zoom: 1.25, unrelated: true}});
    send("removeLocalStorageVals", {keys: ["zoom", "unrelated"]});
    assert.deepEqual(f.calls.filter(call => call.type === "zoom").map(call => call.value), [1, 1.25, 1, 1.25, 1]);
    assert.equal(JSON.stringify(f.calls.filter(call => call.type === "position")[1].value),
        JSON.stringify({cmd: "setTrafficLightPosition", zoom: 1.25, position: {x: 18, y: 12}}));
    assert.equal(f.calls.filter(call => call.type === "fetch").length, 0);
    f.setActive(false);
    send("setLocalStorageVal", {key: "zoom", val: 1.25});
    assert.equal(f.storage.zoom, undefined);
});

test("snippets assign configuration first and wait for Lute before rendering JS", async () => {
    const f = fixture();
    await f.runtime.refreshSnippets();
    const next = {enabledCSS: false, enabledJS: true};
    f.runtime.handleMessage({cmd: "setSnippet", data: next} as IWebSocketData);
    assert.equal(f.config.snippet, next);
    await tick();
    assert.deepEqual(f.calls.map(call => call.type), ["snippet", "lute", "snippet"]);
    assert.equal(f.guards[0](), false);
    assert.equal(f.guards[1](), true);
    f.setActive(false);
    assert.equal(f.guards[1](), false);
});

test("reconnection refreshes notebooks, snippet flags and zoom and ignores stale responses", async () => {
    const f = fixture();
    await f.runtime.reconnect();
    assert.equal(f.config.snippet.enabledJS, true);
    assert.equal(f.storage.zoom, 1.25);
    assert.ok(f.calls.some(call => call.type === "notebooks"));
    assert.ok(f.calls.some(call => call.type === "snippet"));
    const delayed = deferred();
    f.setFetch(() => delayed.promise);
    const reconnected = f.runtime.reconnect();
    f.runtime.handleMessage({cmd: "setLocalStorageVal", data: {key: "zoom", val: 1}} as IWebSocketData);
    f.runtime.handleMessage({cmd: "setSnippet", data: {enabledCSS: false, enabledJS: false}} as IWebSocketData);
    delayed.resolve({code: 0, data: {zoom: 1.25, conf: {snippet: {enabledCSS: true, enabledJS: true}}}});
    await reconnected;
    assert.equal(f.storage.zoom, 1);
    assert.equal(f.config.snippet.enabledCSS, false);
    assert.equal(f.config.snippet.enabledJS, false);
    const closed = deferred();
    f.setFetch(() => closed.promise);
    const pending = f.runtime.reconnect();
    f.setActive(false);
    closed.resolve({code: 0, data: {zoom: 1.25, conf: {snippet: {enabledCSS: true, enabledJS: true}}}});
    await pending;
    assert.equal(f.storage.zoom, 1);
    assert.equal(f.config.snippet.enabledJS, false);
});

test("a newer reconnect zoom read cannot be overwritten by an older reconnect", async () => {
    const f = fixture();
    const older = deferred();
    const newer = deferred();
    let reads = 0;
    f.setFetch(url => url.endsWith("getConf") ? Promise.resolve({code: 0, data: {conf: {snippet: f.config.snippet}}}) :
        (++reads === 1 ? older.promise : newer.promise));
    const first = f.runtime.reconnect();
    const second = f.runtime.reconnect();
    newer.resolve({code: 0, data: {zoom: 1.25}});
    await second;
    older.resolve({code: 0, data: {zoom: 1}});
    await first;
    assert.equal(f.storage.zoom, 1.25);
});

test("notebook entry refresh reports failures and can retry without replacing a disposed view", async () => {
    const f = fixture();
    f.setNotebooks(async () => { throw new Error("offline"); });
    await assert.rejects(f.exports.refreshSettingsWindowNotebooks(), /offline/);
    f.setNotebooks(async () => {});
    await f.exports.refreshSettingsWindowNotebooks();
    const pending = deferred();
    f.setNotebooks(() => pending.promise);
    const refresh = f.exports.refreshSettingsWindowNotebooks();
    f.setActive(false);
    pending.resolve();
    await refresh;
    assert.equal(f.calls.filter(call => call.type === "notebooks").length, 3);
});
