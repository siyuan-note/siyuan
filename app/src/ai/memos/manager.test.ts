import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {MemoryOperationState, memoryModelOptions} from "./state";
import {escapeHtmlTextAndAttr} from "../../util/escape";

class ElementStub {
    value = "";
    textContent = "";
    disabled = false;
    hidden = false;
    listeners = new Map<string, () => void>();
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
}

type Request = {url: string; data: Record<string, unknown>};
const harness = (respond?: (url: string, data: Record<string, unknown>) => unknown | Promise<unknown>,
                 options: {readonly?: boolean; configured?: boolean} = {}) => {
    const requests: Request[] = [];
    const nodes = new Map<string, ElementStub>();
    const root = {querySelector: (selector: string) => {
        if (!nodes.has(selector)) { nodes.set(selector, new ElementStub()); }
        return nodes.get(selector);
    }};
    const timers = new Map<number, {callback: () => void; delay: number}>();
    const confirmations: Array<() => void> = [];
    const config = {readonly: options.readonly === true, ai: {memory: {modelId: options.configured === false ? "" : "memory-model"},
        providers: [{enabled: true, models: [{enabled: true, id: "memory-model", name: "memory-model"}]}]}};
    let serial = 0;
    let timerID = 0;
    let content = "";
    let beforeClose: () => boolean;
    let destroy: () => void;
    const exported = {} as {openMemoryManager: () => void};
    runInNewContext(transpileModule(readFileSync("src/ai/memos/manager.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports: exported,
        require: (name: string) => {
            if (name === "../../dialog") { return {Dialog: class {
                element = root;
                constructor(spec: {content: string; beforeClose: () => boolean; destroyCallback: () => void}) {
                    content = spec.content; beforeClose = spec.beforeClose; destroy = spec.destroyCallback;
                }
                destroy() { destroy(); }
            }}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: (_title: string, _message: string, callback: () => void) => { confirmations.push(callback); }}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: async (url: string, data: Record<string, unknown>) => {
                requests.push({url, data});
                const response = await respond?.(url, data);
                if (response !== undefined) { return response; }
                if (url.endsWith("/overview")) { return {code: 0, data: {count: 0, countComplete: true, memory: "", stale: false}}; }
                if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
                throw new Error(`Unexpected request: ${url}`);
            }}; }
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr}; }
            if (name.endsWith("/genID")) { return {genUUID: () => `operation-${++serial}`}; }
            if (name.endsWith("/functions")) { return {isMobile: () => false}; }
            if (name === "./state") { return {MemoryOperationState, memoryModelOptions}; }
            throw new Error(name);
        },
        window: {siyuan: {config, languages: new Proxy({}, {get: (_, key) => key === "aiMemoryRememberedCount" ? "remembered ${count}" : String(key)})},
            setTimeout: (callback: () => void, delay: number) => { const id = ++timerID; timers.set(id, {callback, delay}); return id; },
            clearTimeout: (id: number) => timers.delete(id)},
    });
    exported.openMemoryManager();
    const flush = async () => { for (let i = 0; i < 30; i++) { await Promise.resolve(); } };
    const field = (selector: string) => root.querySelector(selector);
    const input = field("[data-memory-task-input]");
    const button = field('[data-memory-action="maintain"]');
    const tick = async (delay?: number) => {
        const next = [...timers].find(([, timer]) => delay === undefined || timer.delay === delay);
        assert.ok(next, `Expected pending timer ${delay}`);
        timers.delete(next[0]);
        next[1].callback();
        await flush();
    };
    return {field, input, button, requests, timers, confirmations, config, flush, tick,
        get content() { return content; },
        enter: (text: string) => {input.value = text; input.listeners.get("input")();},
        click: async () => {button.listeners.get("click")(); await flush();},
        close: () => beforeClose(), destroy: () => destroy(), reopen: () => exported.openMemoryManager()};
};

const completed = (id = "task", results: unknown[] = []) => ({code: 0, data: {taskId: id, state: "completed", results}});

test("memory management presents one action and one overview without record-management controls", async () => {
    const state = harness(url => url.endsWith("/overview") ?
        {code: 0, data: {count: 251, countComplete: true, memory: "A unified overview", user: "legacy content", stale: false}} : undefined);
    await state.flush();
    assert.deepEqual([...state.content.matchAll(/data-memory-action="([^"]+)"/g)].map(match => match[1]), ["maintain"]);
    assert.doesNotMatch(state.content, /data-memory-(?:query|list|detail|pagination|task-choice)|<details|<select/);
    assert.equal(state.field("[data-memory-count]").textContent, "remembered 251");
    assert.equal(state.field("[data-memory-overview]").textContent, "A unified overview");
    assert.equal(state.requests.filter(request => request.url.endsWith("/list")).length, 1);
    assert.equal(state.requests.find(request => request.url.endsWith("/list")).data.limit, 1);
    assert.equal(state.timers.size, 0);
});

test("summary text inherits dialog typography and retains multiline wrapping without old editor styles", () => {
    const source = readFileSync("src/ai/memos/manager.ts", "utf8");
    const styles = readFileSync("src/assets/scss/business/_memory-manager.scss", "utf8");
    assert.match(source, /<pre class="memory-manager__status" data-memory-task-status role="status" aria-live="polite">/);
    assert.match(styles, /&__content,\s*&__status\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*font:\s*inherit;/);
    assert.match(styles, /&__status\s*\{\s*max-height:\s*160px;\s*overflow:\s*auto;/);
    assert.doesNotMatch(styles, /&__(?:record|list|detail|field|empty)\b/);
});

test("incomplete counts and stale overviews never display a precise zero or obsolete facts", async () => {
    const state = harness(url => url.endsWith("/overview") ?
        {code: 0, data: {count: 0, countComplete: false, memory: "withdrawn fact", stale: true}} : undefined);
    await state.flush();
    assert.equal(state.field("[data-memory-count]").textContent, "aiMemoryCountUnavailable");
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-overview-status]").textContent, "aiMemoryOverviewPending");
    assert.deepEqual([...state.timers.values()].map(timer => timer.delay), [30000]);
});

test("read-only and unconfigured workspaces never submit a model task", async () => {
    for (const options of [{readonly: true}, {configured: false}]) {
        const state = harness(undefined, options);
        await state.flush();
        state.enter("Remember this");
        await state.click();
        assert.equal(state.button.disabled, true);
        assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
        if (options.configured === false) { assert.match(state.field("[data-memory-model-hint]").textContent, /aiSelectModel.*config.*aiMemory/); }
        state.destroy();
    }
});

test("empty input is explained and pending submission cannot be duplicated or closed", async () => {
    let accept: (response: unknown) => void;
    const state = harness(url => url.endsWith("/maintain") ? new Promise(resolve => {accept = resolve;}) :
        url.endsWith("/task") ? completed() : undefined);
    await state.flush();
    state.enter("   ");
    await state.click();
    assert.equal(state.field("[data-memory-task-status]").textContent, "aiMemoryTaskInputTip");
    assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
    state.enter("Remember this preference");
    await state.click();
    await state.click();
    assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
    assert.equal(state.input.disabled, true);
    assert.equal(state.close(), false);
    accept({code: 0, data: {taskId: "task"}});
    await state.flush();
    assert.equal(state.button.disabled, false);
    assert.equal(state.close(), true);
});

test("completed candidate-only work reports no new usable memory and hides internal results", async () => {
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
        url.endsWith("/task") ? completed("task", [{id: "candidate-internal", saved: true}]) : undefined);
    await state.flush();
    state.enter("A conditional preference");
    await state.click();
    const message = state.field("[data-memory-task-status]").textContent;
    assert.match(message, /aiMemoryTaskNoNewUsable/);
    assert.doesNotMatch(message, /candidate-internal|aiMemoryTaskSaved/);
    assert.equal(state.field("[data-memory-count]").textContent, "remembered 0");
    assert.equal(state.requests.filter(request => request.url.endsWith("/overview")).length, 2);
});

test("unknown final count and concurrent total changes do not invent per-task saved counts", async () => {
    let complete = false;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {count: 7, countComplete: !complete, memory: "", stale: false}}; }
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) { complete = true; return completed("task", [{id: "saved", saved: true}]); }
    });
    await state.flush();
    state.enter("A correction");
    await state.click();
    assert.equal(state.field("[data-memory-count]").textContent, "aiMemoryCountUnavailable");
    assert.equal(state.field("[data-memory-task-status]").textContent, "taskStatusDone");
});

test("temporary task failures automatically requery the same task without another paid request", async () => {
    let attempts = 0;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "same-task"}}; }
        if (url.endsWith("/task")) {
            attempts++;
            if (attempts === 1) { throw new Error("offline"); }
            if (attempts === 2) { return {code: -1, msg: "temporarily unavailable"}; }
            return completed("same-task");
        }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.equal(state.button.disabled, true);
    assert.match(state.field("[data-memory-task-status]").textContent, /offline/);
    await state.click();
    await state.tick(2000);
    await state.tick(4000);
    assert.equal(state.button.disabled, false);
    assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
    assert.ok(state.requests.filter(request => request.url.endsWith("/task")).every(request => request.data.taskId === "same-task"));
});

test("running-task polling does not repeatedly scan the full overview", async () => {
    let count = 0;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) { return ++count < 3 ? {code: 0, data: {taskId: "task", state: "running"}} : completed(); }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    await state.tick(1000);
    assert.equal(state.requests.filter(request => request.url.endsWith("/overview")).length, 1);
    await state.tick(1000);
    assert.equal(state.requests.filter(request => request.url.endsWith("/overview")).length, 2);
});

test("completion waits for its fresh overview before reporting that no usable memories were added", async () => {
    let overviewReads = 0;
    let finishOverview: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview") && ++overviewReads === 2) {
            return new Promise(resolve => { finishOverview = resolve; });
        }
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) { return completed(); }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.equal(state.field("[data-memory-task-status]").textContent, "taskStatusDone");
    finishOverview({code: 0, data: {count: 1, countComplete: true, memory: "New memory", stale: false}});
    await state.flush();
    assert.equal(state.field("[data-memory-task-status]").textContent, "taskStatusDone");
    assert.equal(state.field("[data-memory-count]").textContent, "remembered 1");
});

test("an unavailable task unlocks explicit retry with the same operation identity", async () => {
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "gone"}} :
        url.endsWith("/task") ? {code: -1, msg: "memory task unavailable; retry explicitly"} : undefined);
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.equal(state.button.disabled, false);
    assert.equal(state.timers.size, 0);
    await state.click();
    const submits = state.requests.filter(request => request.url.endsWith("/maintain"));
    assert.equal(submits.length, 2);
    assert.equal(submits[0].data.operationId, submits[1].data.operationId);
});

test("lost submit acknowledgments recover by operation ID without automatically resubmitting", async () => {
    const state = harness(url => {
        if (url.endsWith("/maintain")) { throw new Error("lost acknowledgment"); }
        if (url.endsWith("/task")) { return completed("operation-1"); }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.equal(state.button.disabled, true);
    await state.tick(2000);
    assert.equal(state.button.disabled, false);
    assert.equal(state.requests.find(request => request.url.endsWith("/task")).data.taskId, "operation-1");
    assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
    assert.equal(state.close(), true);
});

test("overview read failures recover automatically and do not claim a zero count", async () => {
    let attempts = 0;
    const state = harness(url => {
        if (url.endsWith("/overview")) {
            if (++attempts === 1) { throw new Error("offline"); }
            return {code: 0, data: {count: 3, countComplete: true, memory: "Valid summary", stale: false}};
        }
    });
    await state.flush();
    assert.equal(state.field("[data-memory-count]").textContent, "aiMemoryCountUnavailable");
    await state.tick(2000);
    assert.equal(state.field("[data-memory-count]").textContent, "remembered 3");
    assert.equal(state.field("[data-memory-overview]").textContent, "Valid summary");
    assert.equal(state.timers.size, 0);
});

test("initial task discovery recovers before permitting another model request", async () => {
    let attempts = 0;
    const state = harness(url => {
        if (url.endsWith("/list")) {
            if (++attempts === 1) { throw new Error("offline"); }
            return {code: 0, data: {tasks: [{taskId: "already-running", state: "running"}]}};
        }
        if (url.endsWith("/task")) { return completed("already-running"); }
    });
    await state.flush();
    state.enter("Do not duplicate");
    await state.click();
    assert.equal(state.button.disabled, true);
    await state.tick(2000);
    assert.equal(state.button.disabled, false);
    assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
});

test("recent failure remains visible without exposing record IDs or internal history controls", async () => {
    const state = harness(url => url.endsWith("/list") ? {code: 0, data: {tasks: [{taskId: "failed", state: "failed"}]}} :
        url.endsWith("/task") ? {code: 0, data: {taskId: "failed", state: "failed", error: "Model request failed", results: [{id: "record-secret", saved: false, error: "record error"}]}} : undefined);
    await state.flush();
    assert.match(state.field("[data-memory-task-status]").textContent, /Model request failed/);
    assert.doesNotMatch(state.field("[data-memory-task-status]").textContent, /record-secret|record error/);
    assert.equal(state.button.disabled, false);
});

test("closing clears recovery timers but never cancels a backend task, and reopening resumes it", async () => {
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "running"}}; }
        if (url.endsWith("/task")) { return {code: 0, data: {taskId: "running", state: "running"}}; }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    state.destroy();
    assert.equal(state.timers.size, 0);
    const polls = state.requests.filter(request => request.url.endsWith("/task")).length;
    state.reopen();
    await state.flush();
    assert.equal(state.requests.filter(request => request.url.endsWith("/task")).length, polls + 1);
    assert.equal(state.requests.some(request => request.url.endsWith("/cancel")), false);
    state.destroy();
});

test("closed dialogs ignore delayed task and overview responses", async () => {
    let finishOverview: (response: unknown) => void;
    let finishTask: (response: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return new Promise(resolve => {finishOverview = resolve;}); }
        if (url.endsWith("/list")) { return {code: 0, data: {tasks: [{taskId: "running", state: "running"}]}}; }
        if (url.endsWith("/task")) { return new Promise(resolve => {finishTask = resolve;}); }
    });
    await state.flush();
    state.destroy();
    finishOverview({code: 0, data: {count: 10, countComplete: true, memory: "late", stale: false}});
    finishTask(completed("running"));
    await state.flush();
    assert.equal(state.field("[data-memory-count]").textContent, "loading");
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.timers.size, 0);
});

test("editing input while a task runs preserves the new draft and requires discard confirmation", async () => {
    let completedTask = false;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) { return completedTask ? completed() : {code: 0, data: {taskId: "task", state: "running"}}; }
    });
    await state.flush();
    state.enter("First text");
    await state.click();
    state.enter("A new unsent draft");
    completedTask = true;
    await state.tick(1000);
    assert.equal(state.input.value, "A new unsent draft");
    assert.equal(state.close(), false);
    assert.equal(state.confirmations.length, 1);
    state.confirmations[0]();
    assert.equal(state.timers.size, 0);
});
