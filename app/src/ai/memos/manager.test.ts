import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {MemoryEditorState, memoryModelOptions} from "./state";
import {escapeHtmlTextAndAttr} from "../../util/escape";

class ElementStub {
    value = "";
    textContent = "";
    disabled = false;
    hidden = false;
    open = false;
    dataset: Record<string, string> = {};
    children: ElementStub[] = [];
    listeners = new Map<string, (event: unknown) => void>();
    addEventListener(name: string, callback: (event: unknown) => void) { this.listeners.set(name, callback); }
    replaceChildren() { this.children = []; }
    append(child: ElementStub) { this.children.push(child); }
    closest() { return this; }
}

const harness = (fetch: (url: string, data: Record<string, unknown>) => Promise<unknown>, readonly = false, confirm = false, configured = true) => {
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
    let content = "";
    let close: () => boolean;
    let destroy: () => void;
    const config = {readonly, ai: {memory: {modelId: configured ? "memory-model" : ""},
        providers: [{enabled: true, models: [{enabled: true, id: "memory-model", name: "memory-model"}]}]}};
    const confirmations: Array<() => void> = [];
    const notices: string[] = [];
    const code = transpileModule(readFileSync("src/ai/memos/manager.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exported = {} as {openMemoryManager: () => void};
    runInNewContext(code, {
        exports: exported,
        require: (name: string) => {
            if (name === "../../dialog") { return {Dialog: class {
                element = root;
                constructor(options: {content: string; beforeClose: () => boolean; destroyCallback: () => void}) {
                    content = options.content; close = options.beforeClose; destroy = options.destroyCallback;
                }
                destroy() { destroy(); }
            }}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: (_title: string, _text: string, callback: () => void) => { confirmations.push(callback); if (confirm) { callback(); } }}; }
            if (name.endsWith("/message")) { return {showMessage: (text: string) => notices.push(text)}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: fetch}; }
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr}; }
            if (name.endsWith("/genID")) { return {genUUID: () => String(++serial)}; }
            if (name.endsWith("/functions")) { return {isMobile: () => false}; }
            if (name === "./state") { return {MemoryEditorState, memoryModelOptions}; }
            throw new Error(name);
        },
        window: {siyuan: {config, languages: new Proxy({}, {get: (_, key) => String(key)})}, clearTimeout, setTimeout},
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
    return {root, flush, click, notices, content, config, confirmations, close: () => close(), destroy: () => destroy()};
};

test("memory manager uses shared disclosure arrows while preserving native details semantics", () => {
    const {content} = harness(async () => ({code: 0, data: {records: [], tasks: []}}));
    const summaries = [...content.matchAll(/<summary\b[^>]*>(.*?)<\/summary>/g)];
    assert.equal(summaries.length, 1);
    for (const [markup, inner] of summaries) {
        assert.match(markup, /class="b3-list-item"/);
        assert.match(inner, /<svg class="b3-list-item__arrow" aria-hidden="true"><use xlink:href="#iconRight"><\/use><\/svg>/);
        assert.match(inner, /class="b3-list-item__text"/);
        assert.doesNotMatch(inner, /<button|tabindex=|role="button"/);
    }
    assert.match(content, /<details><summary/);
    assert.match(content, /<section class="memory-manager__model" data-memory-model>/);
    const styles = readFileSync("src/assets/scss/business/_memory-manager.scss", "utf8");
    assert.match(styles, /summary\s*\{\s*list-style: none;/);
    assert.match(styles, /&::-webkit-details-marker\s*\{\s*display: none;/);
    assert.match(styles, /details\[open\] > summary \.b3-list-item__arrow\s*\{\s*transform: rotate\(90deg\);/);
});

test("record activation preserves failed operation identity and adopts the returned revision", async () => {
    const calls: Array<{url: string; data: Record<string, unknown>}> = [];
    let fail = true;
    let failRead = false;
    const readRecord = {id: "id", content: "draft", kind: "fact", subject: "user", scope: "workspace", state: "candidate", updated: "now", sources: new Array<{id: string}>()};
    const {root, click, notices, flush} = harness(async (url, data) => {
        calls.push({url, data});
        if (url.endsWith("/list")) { return {code: 0, data: {records: [readRecord], errors: new Array<string>(), incomplete: false}}; }
        if (url.endsWith("/get")) { return failRead ? {code: -1, msg: "read failed"} : {code: 0, data: {record: readRecord, revision: "revision-2"}}; }
        if (url.endsWith("/save")) {
            return fail ? {code: -1, msg: "conflict"} : {code: 0, data: {id: "id", revision: "revision-2", saved: true, overviewPending: true}};
        }
        throw new Error(url);
    }, false, true);
    await flush();
    root.querySelector("[data-memory-list]").children[0].listeners.get("click")({});
    await flush();
    await click("enable");
    assert.equal(root.querySelector("[data-memory-content]").textContent, "draft");
    assert.deepEqual(notices, ["conflict"]);
    await click("enable");
    const saves = () => calls.filter(call => call.url.endsWith("/save"));
    assert.equal(saves()[0].data.operationId, saves()[1].data.operationId);
    fail = false;
    failRead = true;
    await click("enable");
    assert.equal(root.querySelector("[data-memory-status]").textContent, "aiMemoryPending");
    assert.match(root.querySelector("[data-memory-record-status]").textContent, /aiMemoryStateActive/);
    assert.equal(root.querySelector('[data-memory-action="enable"]').hidden, true);
    await click("disable");
    assert.equal(saves()[3].data.revision, "revision-2");
    assert.equal(saves()[3].data.id, "id");
    assert.equal(saves()[3].data.content, "draft");
    assert.equal(saves()[3].data.state, "disabled");
    assert.notEqual(saves()[3].data.operationId, saves()[2].data.operationId);
});

test("read-only workspace manager refuses record and model mutations", async () => {
    const calls: string[] = [];
    const {root, click} = harness(async url => {
        calls.push(url);
        return {code: 0, data: {records: new Array<string>(), errors: new Array<string>(), incomplete: false}};
    }, true);
    await click("enable");
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
    await click("disable");
    resolveB({code: 0, data: {record: record("B"), revision: "B1"}});
    await flush();
    assert.equal(root.querySelector("[data-memory-content]").textContent, "A");
    await click("disable");
    assert.equal(saves, 1);
    assert.equal(root.querySelector('[data-memory-action="forget"]').disabled, true);
    resolveSave({code: 0, data: {id: "A", revision: "A2", saved: true, overviewPending: true}});
    await flush();
    await click("disable");
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
    assert.equal(root.querySelector("[data-memory-content]").textContent, "");
    assert.equal(root.querySelector("[data-memory-detail]").hidden, true, "forget returns to the list rather than an unsolicited new draft");
});

test("model input is the primary entry without manual fields or duplicate headings", async () => {
    const {root, click, flush, content} = harness(async () => ({code: 0, data: {records: [], tasks: []}}));
    await flush();
    assert.equal(root.querySelector("[data-memory-detail]").hidden, true);
    assert.doesNotMatch(content, /data-memory-editor|data-memory-field=|data-memory-action="new"|data-memory-action="save"/);
    assert.ok(content.indexOf("data-memory-task-input") < content.indexOf("data-memory-query"));
    assert.match(content, /data-memory-model>\s*<textarea[^>]*aria-label="aiMemoryOrganize"[^>]*placeholder="aiMemoryTaskInputTip"/);
    assert.doesNotMatch(content, /<summary[^>]*>aiMemoryOrganize|<span[^>]*>aiMemoryTaskInputTip/);
    assert.equal(root.querySelector("[data-memory-empty]").hidden, false);
    assert.equal(root.querySelector("[data-memory-empty-title]").textContent, "aiMemoryEmpty");
    assert.equal(root.querySelector("[data-memory-pagination]").hidden, true);
    assert.equal(root.querySelector("[data-memory-status]").textContent, "");
    assert.equal(root.querySelector("[data-memory-task-history]").hidden, true);
    root.querySelector("[data-memory-query]").value = "missing";
    await click("search");
    assert.equal(root.querySelector("[data-memory-empty-title]").textContent, "aiMemoryNoResults");
    assert.equal(root.querySelector("[data-memory-empty-tip]").textContent, "");
});

test("blank model input explains the required source instead of starting a failing paid task", async () => {
    const calls: string[] = [];
    const {root, click} = harness(async url => {
        calls.push(url);
        return {code: 0, data: {records: [], tasks: []}};
    });
    await click("maintain");
    assert.deepEqual(calls, ["/api/ai/memory/list"]);
    assert.equal(root.querySelector("[data-memory-task-status]").textContent, "aiMemoryTaskInputTip");
});

test("model organization submits the entered text and exposes the completed task", async () => {
    const calls: Array<{url: string; data: Record<string, unknown>}> = [];
    const {root, click} = harness(async (url, data) => {
        calls.push({url, data});
        if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "manual-1"}}; }
        if (url.endsWith("/task")) { return {code: 0, data: {taskId: "manual-1", state: "completed", results: []}}; }
        throw new Error(url);
    });
    root.querySelector("[data-memory-task-input]").value = "I prefer short answers";
    await click("maintain");
    assert.equal(calls.find(call => call.url.endsWith("/maintain")).data.text, "I prefer short answers");
    assert.equal(root.querySelector("[data-memory-task-history]").hidden, false);
    assert.equal(root.querySelector("[data-memory-task-status]").textContent, "taskStatusDone");
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, false);
    assert.equal(root.querySelector('[data-memory-action="cancel"]').disabled, true);
});

test("missing or disabled model shows settings guidance without starting a task or saving directly", async () => {
    const calls: string[] = [];
    const {root, click, config} = harness(async url => {
        calls.push(url);
        return {code: 0, data: {records: [], tasks: []}};
    }, false, false, false);
    root.querySelector("[data-memory-task-input]").value = "Remember this";
    await click("maintain");
    assert.equal(root.querySelector("[data-memory-model-hint]").hidden, false);
    assert.match(root.querySelector("[data-memory-model-hint]").textContent, /aiSelectModel.*config - ai - aiMemory/);
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, true);
    config.ai.memory.modelId = "memory-model";
    config.ai.providers[0].enabled = false;
    await click("maintain");
    assert.deepEqual(calls, ["/api/ai/memory/list"]);
    config.ai.providers[0].enabled = true;
    root.querySelector("[data-memory-task-input]").listeners.get("focus")({});
    assert.equal(root.querySelector("[data-memory-model-hint]").hidden, true);
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, false);
});

test("model submission rejects repeated clicks and keeps failed input and retry identity", async () => {
    const calls: Array<{url: string; data: Record<string, unknown>}> = [];
    let resolve: (result: unknown) => void;
    const pending = new Promise(result => { resolve = result; });
    const {root, click, flush, close} = harness(async (url, data) => {
        calls.push({url, data});
        if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
        if (url.endsWith("/maintain")) { return pending; }
        throw new Error(url);
    });
    const input = root.querySelector("[data-memory-task-input]");
    input.value = "A grounded preference";
    input.listeners.get("input")({});
    await click("maintain");
    await click("maintain");
    const submits = () => calls.filter(call => call.url.endsWith("/maintain"));
    assert.equal(submits().length, 1);
    assert.equal(input.disabled, true);
    assert.equal(close(), false);
    resolve({code: -1, msg: "provider unavailable"});
    await flush();
    assert.equal(input.value, "A grounded preference");
    assert.equal(input.disabled, false);
    assert.equal(root.querySelector("[data-memory-task-status]").textContent, "provider unavailable");
    await click("maintain");
    assert.equal(submits()[0].data.operationId, submits()[1].data.operationId);
    assert.equal(close(), false, "failed input still needs discard confirmation");
    assert.ok(calls.every(call => !call.url.endsWith("/save")));
});

test("candidate activation requires confirmation and preserves backend source validation failure", async () => {
    const record = {id: "candidate", content: "<uncertain fact>", kind: "fact", subject: "project", scope: "workspace", state: "review", sources: new Array<{id: string}>()};
    const calls: Array<{url: string; data: Record<string, unknown>}> = [];
    const {root, click, flush, confirmations, notices} = harness(async (url, data) => {
        calls.push({url, data});
        if (url.endsWith("/list")) { return {code: 0, data: {records: [record], tasks: []}}; }
        if (url.endsWith("/get")) { return {code: 0, data: {record, revision: "rev-1"}}; }
        if (url.endsWith("/save")) { return {code: -1, msg: "memory sources require review"}; }
        throw new Error(url);
    });
    await flush();
    root.querySelector("[data-memory-list]").children[0].listeners.get("click")({});
    await flush();
    assert.equal(root.querySelector("[data-memory-content]").textContent, record.content);
    assert.equal(root.querySelector('[data-memory-action="enable"]').hidden, false);
    await click("enable");
    assert.equal(calls.filter(call => call.url.endsWith("/save")).length, 0);
    confirmations[0]();
    await flush();
    const save = calls.find(call => call.url.endsWith("/save"));
    assert.equal(save.data.id, record.id);
    assert.equal(save.data.revision, "rev-1");
    assert.equal(save.data.content, record.content);
    assert.equal(save.data.state, "active");
    assert.deepEqual(notices, ["memory sources require review"]);
    assert.match(root.querySelector("[data-memory-record-status]").textContent, /aiMemoryStateReview/);
});

test("activation confirmation cannot apply after selecting a different record", async () => {
    const record = (id: string) => ({id, content: id, kind: "fact", subject: "user", scope: "workspace", state: "candidate", sources: new Array<{id: string}>()});
    let saves = 0;
    const {root, click, flush, confirmations} = harness(async (url, data) => {
        if (url.endsWith("/list")) { return {code: 0, data: {records: [record("A"), record("B")], tasks: []}}; }
        if (url.endsWith("/get")) { return {code: 0, data: {record: record(String(data.id)), revision: `${data.id}-1`}}; }
        if (url.endsWith("/save")) { saves++; }
        throw new Error(url);
    });
    await flush();
    root.querySelector("[data-memory-list]").children[0].listeners.get("click")({});
    await flush();
    await click("enable");
    root.querySelector("[data-memory-list]").children[1].listeners.get("click")({});
    await flush();
    confirmations[0]();
    await flush();
    assert.equal(saves, 0);
    assert.equal(root.querySelector("[data-memory-content]").textContent, "B");
});

test("an unavailable task permits explicit retry without starting another task automatically", async () => {
    let submits = 0;
    const operations: unknown[] = [];
    const {root, click} = harness(async (url, data) => {
        if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
        if (url.endsWith("/maintain")) {
            submits++;
            operations.push(data.operationId);
            return {code: 0, data: {taskId: "lost-task"}};
        }
        if (url.endsWith("/task")) { return {code: -1, msg: "memory task unavailable; retry explicitly"}; }
        throw new Error(url);
    });
    root.querySelector("[data-memory-task-input]").value = "Remember this preference";
    await click("maintain");
    assert.equal(submits, 1);
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, false);
    assert.equal(root.querySelector('[data-memory-action="task"]').disabled, true);
    assert.match(root.querySelector("[data-memory-task-status]").textContent, /retry explicitly/);
    await click("maintain");
    assert.equal(submits, 2);
    assert.equal(operations[0], operations[1], "retry preserves the operation identity for partial work");
});

test("a temporary task query failure permits querying again but not another paid submission", async () => {
    let submits = 0;
    let failed = true;
    const {root, click, notices} = harness(async url => {
        if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
        if (url.endsWith("/maintain")) { submits++; return {code: 0, data: {taskId: "known-task"}}; }
        if (url.endsWith("/task")) {
            if (failed) { throw new Error("offline"); }
            return {code: 0, data: {taskId: "known-task", state: "completed", results: []}};
        }
        throw new Error(url);
    });
    root.querySelector("[data-memory-task-input]").value = "Remember this preference";
    await click("maintain");
    assert.match(notices[0], /offline/);
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, true);
    assert.equal(root.querySelector('[data-memory-action="task"]').disabled, false);
    await click("maintain");
    assert.equal(submits, 1);
    failed = false;
    await click("task");
    assert.equal(root.querySelector('[data-memory-action="maintain"]').disabled, false);
    assert.equal(submits, 1);
});
