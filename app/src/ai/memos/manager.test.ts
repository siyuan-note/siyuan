import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {MemoryEditorState} from "./state";

class ElementStub {
    value = "";
    textContent = "";
    disabled = false;
    dataset: Record<string, string> = {};
    children: ElementStub[] = [];
    listeners = new Map<string, (event: unknown) => void>();
    addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, callback); }
    replaceChildren() { this.children = []; }
    append(child: ElementStub) { this.children.push(child); }
    closest() { return this; }
}

const harness = (fetch: (url: string, data: Record<string, unknown>) => Promise<unknown>, readonly = false, confirm = false) => {
    const nodes = new Map<string, ElementStub>();
    const root = new ElementStub() as ElementStub & {
        querySelector: (key: string) => ElementStub;
        querySelectorAll: () => ElementStub[];
    };
    root.querySelector = key => {
        if (!nodes.has(key)) { nodes.set(key, new ElementStub()); }
        return nodes.get(key);
    };
    root.querySelectorAll = () => [];
    let serial = 0;
    const notices: string[] = [];
    const code = transpileModule(readFileSync("src/ai/memos/manager.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exported = {} as {openMemoryManager: () => void};
    runInNewContext(code, {
        exports: exported,
        require: (name: string) => {
            if (name === "../../dialog") { return {Dialog: class {element = root;}}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: (_title: string, _text: string, callback: () => void) => { if (confirm) { callback(); } }}; }
            if (name.endsWith("/message")) { return {showMessage: (text: string) => notices.push(text)}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: fetch}; }
            if (name.endsWith("/escape")) { return {escapeHtml: (text: string) => text}; }
            if (name.endsWith("/genID")) { return {genUUID: () => String(++serial)}; }
            if (name.endsWith("/functions")) { return {isMobile: () => false}; }
            if (name === "./state") { return {MemoryEditorState}; }
            throw new Error(name);
        },
        window: {siyuan: {config: {readonly}, languages: new Proxy({}, {get: (_, key) => String(key)})}, clearTimeout, setTimeout},
        document: {createElement: () => new ElementStub()},
    });
    exported.openMemoryManager();
    const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); } };
    const click = async (name: string) => {
        const target = new ElementStub();
        target.dataset.memoryAction = name;
        root.listeners.get("click")({target});
        await flush();
    };
    return {root, flush, click, notices};
};

test("memory manager preserves failed draft and operation identity, then uses returned revision", async () => {
    const calls: Array<{url: string; data: Record<string, unknown>}> = [];
    let fail = true;
    let failRead = false;
    const readRecord = {id: "id", content: "draft", kind: "fact", subject: "user", scope: "workspace", state: "active", updated: "now", sources: new Array<{id: string}>()};
    const {root, click, notices} = harness(async (url, data) => {
        calls.push({url, data});
        if (url.endsWith("/list")) { return {code: 0, data: {records: new Array<typeof readRecord>(), errors: new Array<string>(), incomplete: false}}; }
        if (url.endsWith("/get")) { return failRead ? {code: -1, msg: "read failed"} : {code: 0, data: {record: readRecord, revision: "revision-2"}}; }
        if (url.endsWith("/save")) {
            return fail ? {code: -1, msg: "conflict"} : {code: 0, data: {id: "id", revision: "revision-2", saved: true, overviewPending: true}};
        }
        throw new Error(url);
    });
    root.querySelector('[data-memory-field="content"]').value = "draft";
    await click("save");
    assert.equal(root.querySelector('[data-memory-field="content"]').value, "draft");
    assert.deepEqual(notices, ["conflict"]);
    await click("save");
    const saves = () => calls.filter(call => call.url.endsWith("/save"));
    assert.equal(saves()[0].data.operationId, saves()[1].data.operationId);
    fail = false;
    failRead = true;
    await click("save");
    assert.equal(root.querySelector("[data-memory-status]").textContent, "aiMemoryPending");
    root.querySelector('[data-memory-field="content"]').value = "corrected";
    await click("save");
    assert.equal(saves()[3].data.revision, "revision-2");
    assert.equal(saves()[3].data.id, "id");
    assert.notEqual(saves()[3].data.operationId, saves()[2].data.operationId);
});

test("read-only workspace manager refuses manual and model mutations", async () => {
    const calls: string[] = [];
    const {root, click} = harness(async url => {
        calls.push(url);
        return {code: 0, data: {records: new Array<string>(), errors: new Array<string>(), incomplete: false}};
    }, true);
    await click("save");
    await click("disable");
    await click("maintain");
    await click("cancel");
    assert.deepEqual(calls, ["/api/ai/memory/list"]);
    assert.equal(root.querySelector('[data-memory-action="forget"]').disabled, true);
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, true);
});

test("recent automatic failure is visible without knowing task identity or starting another model request", async () => {
    const calls: string[] = [];
    const task = {taskId: "automatic-1", state: "failed", error: "configuration changed", results: new Array<string>(), overviewPending: false};
    const {root, flush, click} = harness(async url => {
        calls.push(url);
        if (url.endsWith("/list")) { return {code: 0, data: {records: new Array<string>(), errors: new Array<string>(), incomplete: false, tasks: [task]}}; }
        if (url.endsWith("/task")) { return {code: 0, data: task}; }
        throw new Error(url);
    });
    await flush();
    assert.equal(root.querySelector("[data-memory-task-choice]").value, "automatic-1");
    assert.match(root.querySelector("[data-memory-task-status]").textContent, /configuration changed/);
    assert.deepEqual(calls, ["/api/ai/memory/list"]);
    await click("task");
    assert.equal(calls.filter(url => url.endsWith("/list")).length, 2, "terminal task refresh must not create a list/poll loop");
    assert.equal(calls.filter(url => url.endsWith("/task")).length, 1);
});

test("pending selection cannot replace or unlock a save, including its refresh", async () => {
    const record = (id: string) => ({id, content: id, kind: "fact", subject: "user", scope: "workspace", state: "active", updated: "now", sources: new Array<{id: string}>()});
    let resolveB: (result: unknown) => void;
    const pendingB = new Promise(resolve => { resolveB = resolve; });
    let resolveSave: (result: unknown) => void;
    const pendingSave = new Promise(resolve => { resolveSave = resolve; });
    let resolveRefresh: (result: unknown) => void;
    const pendingRefresh = new Promise(resolve => { resolveRefresh = resolve; });
    let saves = 0;
    let aReads = 0;
    const {root, click, flush} = harness(async (url, data) => {
        if (url.endsWith("/list")) { return {code: 0, data: {records: [record("A"), record("B")], errors: new Array<string>(), incomplete: false}}; }
        if (url.endsWith("/get")) {
            if (data.id === "B") { return pendingB; }
            if (++aReads > 1) { return pendingRefresh; }
            return {code: 0, data: {record: record("A"), revision: "A1"}};
        }
        if (url.endsWith("/save")) {
            saves++;
            assert.equal(data.id, "A");
            assert.equal(data.revision, "A1");
            return pendingSave;
        }
        throw new Error(url);
    });
    await flush();
    root.querySelector("[data-memory-list]").children[0].listeners.get("click")({});
    await flush();
    root.querySelector("[data-memory-list]").children[1].listeners.get("click")({});
    await click("save");
    resolveB({code: 0, data: {record: record("B"), revision: "B1"}});
    await flush();
    assert.equal(root.querySelector('[data-memory-field="content"]').value, "A");
    await click("save");
    assert.equal(saves, 1);
    assert.equal(root.querySelector('[data-memory-action="forget"]').disabled, true);
    resolveSave({code: 0, data: {id: "A", revision: "A2", saved: true, overviewPending: true}});
    await flush();
    await click("save");
    assert.equal(saves, 1, "refresh must remain inside the mutation lock");
    resolveRefresh({code: 0, data: {record: record("A"), revision: "A2"}});
    await flush();
    assert.equal(root.querySelector('[data-memory-action="forget"]').disabled, false);
});


test("forget distinguishes logical withdrawal from pending physical cleanup", async () => {
    const record = {id: "A", content: "A", kind: "fact", subject: "user", scope: "workspace", state: "active", updated: "now", sources: new Array<{id: string}>()};
    const {root, click, flush, notices} = harness(async url => {
        if (url.endsWith("/list")) { return {code: 0, data: {records: [record], errors: new Array<string>(), incomplete: false}}; }
        if (url.endsWith("/get")) { return {code: 0, data: {record, revision: "A1"}}; }
        if (url.endsWith("/forget")) { return {code: 0, data: {saved: true, cleanupPending: true}}; }
        throw new Error(url);
    }, false, true);
    await flush();
    root.querySelector("[data-memory-list]").children[0].listeners.get("click")({});
    await flush();
    await click("forget");
    assert.deepEqual(notices, ["aiMemoryCleanupPending"]);
    assert.equal(root.querySelector('[data-memory-field="content"]').value, "");
});
