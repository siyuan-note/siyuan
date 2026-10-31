import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {MemoryOperationState, memoryModelOptions} from "./state";
import {escapeHtmlTextAndAttr} from "../../util/escape";
import {memoryTaskErrorMessage} from "./taskError";

class ElementStub {
    value = "";
    textContent = "";
    disabled = false;
    hidden = false;
    title = "";
    attributes = new Map<string, string>();
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    listeners = new Map<string, (event?: KeyboardEvent) => void>();
    addEventListener(name: string, callback: (event?: KeyboardEvent) => void) { this.listeners.set(name, callback); }
    click() { if (!this.disabled) { this.listeners.get("click")?.(); } }
    getBoundingClientRect() { return {left: 20, right: 44, bottom: 40, height: 24}; }
}

type Request = {url: string; data: Record<string, unknown>; signal?: AbortSignal};
const harness = (respond?: (url: string, data: Record<string, unknown>) => unknown | Promise<unknown>,
                 options: {readonly?: boolean; configured?: boolean; translate?: boolean; mac?: boolean; mobile?: boolean} = {}) => {
    const requests: Request[] = [];
    const messages: string[] = [];
    const rendered: string[] = [];
    const nodes = new Map<string, ElementStub>();
    const root = {querySelector: (selector: string) => {
        if (!nodes.has(selector)) { nodes.set(selector, new ElementStub()); }
        return nodes.get(selector);
    }};
    const timers = new Map<number, {callback: () => void; delay: number}>();
    const confirmations: Array<() => void> = [];
    const menuItems: Array<{icon: string; warning: boolean; label: string; click: () => void}> = [];
    const refreshed: string[] = [];
    const remounted: string[] = [];
    let destroyed = 0;
    const config = {lang: "zh-CN", readonly: options.readonly === true, ai: {memory: {enabled: options.translate === true, modelId: options.configured === false ? "" : "memory-model", reasoningEffort: ""},
        providers: [{enabled: true, models: [{enabled: true, id: "memory-model", name: "memory-model"}]}]}};
    let refreshing = false;
    let serial = 0;
    let timerID = 0;
    let content = "";
    let title = "";
    let beforeClose: () => boolean;
    let destroy: () => void;
    const exported = {} as {openMemoryManager: () => void};
    const compatibility = {} as {isOnlyMeta: (event: KeyboardEvent) => boolean};
    const metaSource = readFileSync("src/protyle/util/compatibility.ts", "utf8")
        .match(/export const isOnlyMeta = [\s\S]*?(?=\nexport const isNotCtrl)/)[0];
    runInNewContext(transpileModule(metaSource, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText,
        {exports: compatibility, isMac: () => options.mac === true});
    runInNewContext(transpileModule(readFileSync("src/ai/memos/manager.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports: exported,
        AbortController,
        require: (name: string) => {
            if (name === "../../menus/Menu") { return {MenuItem: class {
                element: unknown;
                constructor(spec: unknown) { this.element = spec; }
            }}; }
            if (name === "../../menus/menuToggle") { return {toggleMenu: (spec: {build: (menu: unknown, session: unknown) => void}) => {
                spec.build({append: (item: typeof menuItems[number]) => { menuItems.push(item); }, popup: () => {}}, {show: (render: () => void) => render()});
            }}; }
            if (name === "../../config/setting/sync") { return {refreshSettingConfigAfter: async (namespace: string, save: () => Promise<boolean>) => {
                refreshed.push(namespace); return save();
            }}; }
            if (name === "../../config/tabs/ai/aiRuntime") { return {aiConfigApi: {apply: (ai: typeof config.ai) => { config.ai = ai; }}}; }
            if (name === "../../config/setting/mount") { return {remountOpenSettingTab: async (tab: string) => { remounted.push(tab); }}; }
            if (name === "./taskError") { return {memoryTaskErrorMessage}; }
            if (name === "../../protyle/util/compatibility") { return compatibility; }
            if (name === "./overview") { return {renderMemoryOverview: (element: ElementStub, markdown: string) => { rendered.push(markdown); element.textContent = markdown; }}; }
            if (name === "../../dialog/message") { return {showMessage: (message: string) => { messages.push(message); }}; }
            if (name === "../../dialog") { return {Dialog: class {
                element = root;
                constructor(spec: {title: string; content: string; beforeClose: () => boolean; destroyCallback: () => void}) {
                    title = spec.title; content = spec.content; beforeClose = spec.beforeClose; destroy = spec.destroyCallback;
                }
                destroy() { if (beforeClose()) { destroyed++; destroy(); } }
            }}; }
            if (name.endsWith("/confirmDialog")) { return {confirmDialog: (_title: string, _message: string, callback: () => void) => { confirmations.push(callback); }}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: async (url: string, data: Record<string, unknown>, _headers: unknown, _process: boolean, signal?: AbortSignal) => {
                requests.push({url, data, signal});
                const response = await respond?.(url, data);
                if (response !== undefined) { return response; }
                if (url.endsWith("/overview")) { return {code: 0, data: {count: 0, countComplete: true, memory: "", stale: false}}; }
                if (url.endsWith("/list")) { return {code: 0, data: {records: [], tasks: []}}; }
                if (refreshing && url.endsWith("/maintain")) { return {code: 0, data: {taskId: "refresh-task"}}; }
                if (refreshing && url.endsWith("/task")) { return {code: 0, data: {taskId: "refresh-task", state: "completed"}}; }
                throw new Error(`Unexpected request: ${url}`);
            }}; }
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr}; }
            if (name.endsWith("/genID")) { return {genUUID: () => `operation-${++serial}`}; }
            if (name.endsWith("/functions")) { return {isMobile: () => options.mobile === true}; }
            if (name === "./state") { return {MemoryOperationState, memoryModelOptions}; }
            throw new Error(name);
        },
        window: {siyuan: {config, languages: new Proxy({}, {get: (_, key) => key === "_kernel" ? {448: "Safe model connection error", 450: "Safe model authentication error", 456: "Safe model output format error"} : String(key)})},
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
    return {field, input, button, requests, messages, rendered, timers, confirmations, config, flush, tick, menuItems, refreshed, remounted,
        get destroyed() { return destroyed; },
        more: () => field("[data-memory-more]").listeners.get("click")({stopPropagation: () => {}} as KeyboardEvent),
        get content() { return content; },
        get title() { return title; },
        enter: (text: string) => {input.value = text; input.listeners.get("input")();},
        click: async () => {button.listeners.get("click")(); await flush();},
        refresh: async () => {
            const previous = input.value;
            input.value = "Refresh through an explicitly submitted task";
            refreshing = true;
            button.click();
            await flush();
            refreshing = false;
            input.value = previous;
        },
        keydown: async (properties: Partial<KeyboardEvent> = {}) => {
            let prevented = false;
            let stopped = false;
            input.listeners.get("keydown")({key: "Enter", ...properties,
                preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; }} as KeyboardEvent);
            await flush();
            return {prevented, stopped};
        },
        close: () => beforeClose(), destroy: () => destroy(), reopen: () => exported.openMemoryManager()};
};

const completed = (id = "task", results: unknown[] = []) => ({code: 0, data: {taskId: id, state: "completed", results}});

test("successful and unchanged completed submissions clear their input through either submit path", async () => {
    for (const keyboard of [false, true]) {
        for (const results of [[], [{saved: false, error: ""}], [{saved: true, error: ""}]]) {
            const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
                url.endsWith("/task") ? completed("task", results) : undefined);
            await state.flush();
            state.enter("Remember this");
            if (keyboard) { await state.keydown({}); } else { await state.click(); }
            assert.equal(state.input.value, "");
            assert.equal(state.close(), true);
            await state.click();
            assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
        }
    }
});

test("the shared header menu confirms a red trash action that clears and disables memory", async () => {
    for (const mobile of [false, true]) {
        for (const configured of [false, true]) {
            const state = harness(url => url.endsWith("/clear") ? {code: 0, data: {disabled: true, cleared: true}} : undefined, {mobile, configured, translate: true});
            await state.flush();
            state.enter("Unsent draft");
            state.more();
            assert.equal(state.menuItems.length, 1);
            const action = state.menuItems[0];
            assert.equal(action.icon, "iconTrashcan");
            assert.equal(action.warning, true);
            assert.equal(action.label, "aiMemoryClearAndDisable");
            action.click();
            assert.equal(state.confirmations.length, 1);
            assert.equal(state.requests.some(request => request.url.endsWith("/clear")), false);
            state.confirmations[0]();
            await state.flush();
            assert.equal(state.requests.filter(request => request.url.endsWith("/clear")).length, 1);
            assert.equal(state.config.ai.memory.enabled, false);
            assert.deepEqual(state.refreshed, ["ai"]);
            assert.deepEqual(state.remounted, mobile ? ["ai"] : []);
            assert.equal(state.input.value, "");
            assert.equal(state.destroyed, 1);
            assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
        }
    }
});

test("cancelled confirmation and readonly transitions cannot clear memories", async () => {
    const state = harness();
    await state.flush();
    state.more();
    state.menuItems[0].click();
    await state.flush();
    assert.equal(state.requests.some(request => request.url.endsWith("/clear")), false);
    state.config.readonly = true;
    state.confirmations[0]();
    await state.flush();
    assert.equal(state.requests.some(request => request.url.endsWith("/clear")), false);
    const readonly = harness(undefined, {readonly: true});
    await readonly.flush();
    readonly.more();
    assert.equal(readonly.menuItems.length, 0);
});

test("clearing blocks duplicate requests and ignores late task responses", async () => {
    let finishTask: (result: unknown) => void;
    let finishClear: (result: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "running"}}; }
        if (url.endsWith("/task")) { return new Promise(resolve => { finishTask = resolve; }); }
        if (url.endsWith("/clear")) { return new Promise(resolve => { finishClear = resolve; }); }
    }, {translate: true});
    await state.flush();
    state.enter("Remember this");
    await state.click();
    state.more();
    state.menuItems[0].click();
    state.confirmations[0]();
    await state.flush();
    assert.equal(state.close(), false);
    assert.equal(state.button.disabled, true);
    assert.equal(state.input.disabled, true);
    state.confirmations[0]();
    await state.flush();
    assert.equal(state.requests.filter(request => request.url.endsWith("/clear")).length, 1);
    finishTask({code: 0, data: {taskId: "running", state: "failed", error: "memory configuration changed; retry explicitly"}});
    await state.flush();
    assert.deepEqual(state.messages, []);
    finishClear({code: 0, data: {disabled: true, cleared: true}});
    await state.flush();
    assert.equal(state.destroyed, 1);
    assert.equal(state.timers.size, 0);
});

test("partial cleanup preserves the draft and the disabled setting for an explicit retry", async () => {
    const state = harness(url => url.endsWith("/clear") ? {code: 0, data: {disabled: true, cleared: false}} : undefined, {translate: true});
    await state.flush();
    state.enter("Keep this draft");
    state.more();
    state.menuItems[0].click();
    state.confirmations[0]();
    await state.flush();
    assert.equal(state.config.ai.memory.enabled, false);
    assert.equal(state.destroyed, 0);
    assert.equal(state.input.value, "Keep this draft");
    assert.equal(state.close(), false);
    assert.deepEqual(state.messages, ["aiMemoryClearFailed"]);
    assert.equal(state.requests.filter(request => request.url.endsWith("/clear")).length, 1);
});

test("a rejected clear resumes polling without resubmitting the running model task", async () => {
    for (const disconnected of [false, true]) {
        const state = harness(url => {
            if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "running"}}; }
            if (url.endsWith("/task")) { return {code: 0, data: {taskId: "running", state: "running"}}; }
            if (url.endsWith("/clear")) {
                if (disconnected) { throw new Error("Disconnected"); }
                return {code: -1, msg: "Unable to save settings"};
            }
        }, {translate: true});
        await state.flush();
        state.enter("Keep this pending request");
        await state.click();
        state.more();
        state.menuItems[0].click();
        state.confirmations[0]();
        await state.flush();
        assert.equal(state.input.value, "Keep this pending request");
        assert.equal(state.destroyed, 0);
        assert.equal(state.button.disabled, true);
        assert.equal(state.config.ai.memory.enabled, true);
        assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
        assert.equal(state.requests.filter(request => request.url.endsWith("/task")).length, 2);
        assert.equal(state.messages.length, 1);
        assert.ok(state.messages[0].endsWith(disconnected ? "Disconnected" : "Unable to save settings"));
        await state.tick(1000);
        assert.equal(state.requests.filter(request => request.url.endsWith("/task")).length, 3);
    }
});

test("failed and partially failed tasks preserve their input for explicit retry", async () => {
    for (const task of [
        {state: "failed", error: "Model error", results: [] as unknown[]},
        {state: "completed", error: "Partial failure", results: [] as unknown[]},
        {state: "completed", error: "", results: [{saved: true, error: ""}, {saved: false, error: "Conflict"}]},
    ]) {
        const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
            url.endsWith("/task") ? {code: 0, data: {taskId: "task", ...task}} : undefined);
        await state.flush();
        state.enter("Retry this");
        await state.click();
        assert.equal(state.input.value, "Retry this");
        assert.equal(state.close(), false);
    }
});

test("task failure notifications include safe item classifications and never raw result text", async () => {
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
        url.endsWith("/task") ? {code: 0, data: {taskId: "task", state: "failed",
            error: "some memory proposals were not saved; saved memories remain available",
            results: [{saved: true}, {error: "proposal target not in verified snapshot"}, {error: "private token /workspace/secret"}]}} : undefined);
    await state.flush();
    state.enter("Delete the spacing rule");
    await state.click();
    assert.deepEqual(state.messages, ["aiMemoryPartialFailure\naiMemoryTargetUnclear"]);
    assert.equal(state.input.value, "Delete the spacing rule");
});

test("preflight intent failures and controlled model errors remain actionable without exposing provider text", async () => {
    for (const [error, message] of [["memory proposal does not match forget intent", "aiMemoryIntentUnclear"],
        ["invalid memory forget selection", "Safe model output format error"],
        ["forget verification exceeds budget", "aiMemoryProcessingLimit"],
        ["memory scope scan incomplete", "aiMemoryReadFailed"],
        ["Safe model authentication error", "Safe model authentication error"],
        ["provider body contains private token", "embeddingFailed"]]) {
        const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
            url.endsWith("/task") ? {code: 0, data: {taskId: "task", state: "failed", error}} : undefined);
        await state.flush();
        state.enter("Remember this");
        await state.click();
        assert.deepEqual(state.messages, [message]);
    }
});

test("editing and restoring the same text while submission is pending cannot be cleared by its completion", async () => {
    let accept: (response: unknown) => void;
    const state = harness(url => url.endsWith("/maintain") ? new Promise(resolve => { accept = resolve; }) :
        url.endsWith("/task") ? completed() : undefined);
    await state.flush();
    state.enter("Original");
    await state.click();
    state.enter("Edited");
    state.enter("Original");
    accept({code: 0, data: {taskId: "task"}});
    await state.flush();
    assert.equal(state.input.value, "Original");
    assert.equal(state.close(), false);
});

test("editing back to identical text during a running task preserves the new draft revision", async () => {
    let reads = 0;
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
        url.endsWith("/task") ? (++reads === 1 ? {code: 0, data: {taskId: "task", state: "running"}} : completed()) : undefined);
    await state.flush();
    state.enter("Original");
    await state.click();
    state.enter("Edited");
    state.enter("Original");
    await state.tick(1000);
    assert.equal(state.input.value, "Original");
    assert.equal(state.close(), false);
});

test("restored tasks and old completion responses after reopening never clear a new window's draft", async () => {
    const finish: Array<(response: unknown) => void> = [];
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "task"}} :
        url.endsWith("/task") ? new Promise(resolve => { finish.push(resolve); }) : undefined);
    await state.flush();
    state.enter("Same text");
    await state.click();
    state.destroy();
    state.reopen();
    await state.flush();
    state.enter("Same text");
    finish[0](completed());
    await state.flush();
    assert.equal(state.input.value, "Same text");
    finish[1](completed());
    await state.flush();
    assert.equal(state.input.value, "Same text");
    assert.equal(state.close(), false);
});

test("Enter with or without the local platform modifier submits exactly once", async () => {
    for (const mac of [false, true]) {
        for (const modifier of [{}, mac ? {metaKey: true} : {ctrlKey: true}]) {
            let finish: (value: unknown) => void;
            const state = harness(url => {
                if (url.endsWith("/maintain")) { return new Promise(resolve => { finish = resolve; }); }
                if (url.endsWith("/task")) { return {code: 0, data: {taskId: "task", state: "running"}}; }
            }, {mac});
            await state.flush();
            state.enter("Remember this");
            assert.deepEqual(await state.keydown(modifier), {prevented: true, stopped: true});
            assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
            assert.equal(state.field("[data-memory-loading]").hidden, false);
            assert.equal(state.button.attributes.get("aria-busy"), "true");
            await state.keydown(modifier);
            await state.keydown({...modifier, repeat: true});
            assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
            finish({code: 0, data: {taskId: "task"}});
            await state.flush();
            await state.keydown(modifier);
            assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
        }
    }
});

test("other modifiers, IME confirmation and repeated keydown retain their normal behavior", async () => {
    for (const mac of [false, true]) {
        const state = harness(undefined, {mac});
        await state.flush();
        state.enter("Remember this");
        const modifier = mac ? {metaKey: true} : {ctrlKey: true};
        for (const properties of [mac ? {ctrlKey: true} : {metaKey: true}, {ctrlKey: true, metaKey: true},
            {isComposing: true}, {keyCode: 229}, {repeat: true}, {shiftKey: true}, {altKey: true}, {key: "Escape"},
            {...modifier, altKey: true}, {...modifier, shiftKey: true}, {...modifier, isComposing: true},
            {...modifier, keyCode: 229}, {...modifier, repeat: true}, {...modifier, key: "Escape"}]) {
            assert.deepEqual(await state.keydown(properties), {prevented: false, stopped: false});
        }
        assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
    }
});

test("keyboard organization honors blank, readonly, missing model, discovering and closed guards", async () => {
    for (const options of [{readonly: true}, {configured: false}, {}]) {
        const state = harness(undefined, options);
        await state.flush();
        state.enter(options.readonly || options.configured === false ? "Remember this" : "   ");
        await state.keydown({});
        assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
    }
    const discovering = harness(url => url.endsWith("/list") ? new Promise(() => {}) : undefined);
    await discovering.flush();
    discovering.enter("Remember this");
    await discovering.keydown({});
    assert.equal(discovering.requests.some(request => request.url.endsWith("/maintain")), false);
    const closed = harness();
    await closed.flush();
    closed.enter("Remember this");
    closed.destroy();
    assert.deepEqual(await closed.keydown({}), {prevented: false, stopped: false});
    assert.equal(closed.requests.some(request => request.url.endsWith("/maintain")), false);
});

test("submission and running phases use only the button spinner; only failures produce notifications", async () => {
    for (const terminal of ["completed", "failed"]) {
        let accept: (value: unknown) => void;
        let reads = 0;
        const state = harness(url => {
            if (url.endsWith("/maintain")) { return new Promise(resolve => { accept = resolve; }); }
            if (url.endsWith("/task")) {
                const phase = ["queued", "running", terminal][reads++];
                return {code: 0, data: {taskId: "task", state: phase, error: phase === "failed" ? "Model failed" : ""}};
            }
        });
        await state.flush();
        state.enter("Remember this");
        await state.click();
        assert.equal(state.field("[data-memory-loading]").hidden, false);
        accept({code: 0, data: {taskId: "task"}});
        await state.flush();
        assert.equal(state.field("[data-memory-loading]").hidden, false);
        await state.tick(1000);
        assert.equal(state.field("[data-memory-loading]").hidden, false);
        await state.tick(1000);
        assert.equal(state.field("[data-memory-loading]").hidden, true);
        assert.equal(state.button.attributes.get("aria-busy"), "false");
        assert.deepEqual(state.messages, terminal === "failed" ? ["embeddingFailed"] : []);
    }
});

test("pending display processing shows only its spinner without rendering the original, then reuses the result", async () => {
    let resolveTranslation: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original [20261030081347-eyy3fb5]", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { resolveTranslation = resolve; }); }
    }, {translate: true});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.deepEqual(state.rendered, []);
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    assert.equal(state.field("[data-memory-loading]").hidden, true);
    assert.deepEqual({...state.requests.find(request => request.url.endsWith("/translate")).data},
        {memory: "Original [20261030081347-eyy3fb5]", language: "zh-CN"});
    resolveTranslation({code: 0, data: {memory: "Translated", language: "zh-CN"}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "Translated");
    assert.ok(state.rendered.every(text => text === "Translated"));
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
    await state.refresh();
    assert.equal(state.requests.filter(request => request.url.endsWith("/translate")).length, 1);
    assert.equal(state.field("[data-memory-overview]").textContent, "Translated");
});

test("translation is skipped for readonly, disabled or unconfigured memory", async () => {
    for (const options of [{translate: false}, {translate: true, readonly: true}, {translate: true, configured: false}]) {
        const state = harness(url => url.endsWith("/overview") ?
            {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}} : undefined, options);
        await state.flush();
        assert.equal(state.requests.some(request => request.url.endsWith("/translate")), false);
        assert.equal(state.field("[data-memory-overview]").textContent, "Original");
    }
});

test("initial overview loading and refreshing an old display show only the content spinner", async () => {
    const finish: Array<(value: unknown) => void> = [];
    const state = harness(url => {
        if (url.endsWith("/overview")) { return new Promise(resolve => { finish.push(resolve); }); }
    });
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    finish[0]({code: 0, data: {memory: "Previous", stale: false, countComplete: false}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "Previous");
    await state.refresh();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    finish[1]({code: 0, data: {memory: "Current", stale: false, countComplete: true, count: 1}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "Current");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("refreshing the same pending source retains one request and ignores an older waiter", async () => {
    let finish: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { finish = resolve; }); }
    }, {translate: true});
    await state.flush();
    await state.refresh();
    assert.equal(state.requests.filter(request => request.url.endsWith("/translate")).length, 1);
    assert.deepEqual(state.rendered, []);
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    finish({code: 0, data: {memory: "Ready", language: "zh-CN"}});
    await state.flush();
    assert.deepEqual(state.rendered, ["Ready"]);
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("reopening keeps content empty while processing and ignores the closed dialog response", async () => {
    const finish: Array<(value: unknown) => void> = [];
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { finish.push(resolve); }); }
    }, {translate: true});
    await state.flush();
    state.destroy();
    state.reopen();
    await state.flush();
    finish[0]({code: 0, data: {memory: "Obsolete", language: "zh-CN"}});
    await state.flush();
    assert.deepEqual(state.rendered, []);
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    finish[1]({code: 0, data: {memory: "Current", language: "zh-CN"}});
    await state.flush();
    assert.deepEqual(state.rendered, ["Current"]);
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("failed translation retains the original and overview refresh never retries the failed display request", async () => {
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { throw new Error("Translation unavailable"); }
    }, {translate: true});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "Original");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
    assert.equal(state.messages.length, 1);
    await state.refresh();
    assert.equal(state.requests.filter(request => request.url.endsWith("/translate")).length, 1);
    assert.equal(state.messages.length, 2, "an explicitly submitted new task starts a new notification cycle");
    assert.equal(state.messages[0], state.messages[1]);
});

test("old translation responses cannot overwrite a newer overview or a changed UI language", async () => {
    const resolveTranslations: Array<(value: unknown) => void> = [];
    let reads = 0;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: ++reads === 1 ? "Old" : "New", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { resolveTranslations.push(resolve); }); }
    }, {translate: true});
    await state.flush();
    await state.refresh();
    assert.equal(state.requests.find(request => request.url.endsWith("/translate")).signal.aborted, true);
    resolveTranslations[0]({code: 0, data: {memory: "Old translated", language: "zh-CN"}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    state.config.lang = "en_US";
    resolveTranslations[1]({code: 0, data: {memory: "Wrong language", language: "zh-CN"}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "New");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("translation completion after closing neither changes the old view nor posts an error", async () => {
    let finish: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { finish = resolve; }); }
    }, {translate: true});
    await state.flush();
    state.destroy();
    assert.equal(state.requests.find(request => request.url.endsWith("/translate")).signal.aborted, true);
    finish({code: -1, msg: "Translation failed"});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.messages.length, 0);
});

test("a failed response for a replaced model falls back to the current source without surfacing the obsolete error", async () => {
    let finish: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { finish = resolve; }); }
    }, {translate: true});
    await state.flush();
    state.config.ai.memory.modelId = "replacement-model";
    finish({code: -1, msg: "Old model failed"});
    await state.flush();
    assert.deepEqual(state.rendered, ["Original"]);
    assert.equal(state.messages.length, 0);
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("configuration changes while pending settle on the current source rather than a blank view or obsolete result", async () => {
    for (const change of ["language", "providers", "effort"]) {
        let finish: (value: unknown) => void;
        const state = harness(url => {
            if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}}; }
            if (url.endsWith("/translate")) { return new Promise(resolve => { finish = resolve; }); }
        }, {translate: true});
        await state.flush();
        assert.deepEqual(state.rendered, []);
        if (change === "language") { state.config.lang = "en_US"; }
        if (change === "providers") { state.config.ai.providers = [...state.config.ai.providers]; }
        if (change === "effort") { state.config.ai.memory.reasoningEffort = "high"; }
        finish({code: 0, data: {memory: "Obsolete", language: "zh-CN"}});
        await state.flush();
        assert.deepEqual(state.rendered, ["Original"]);
        assert.equal(state.field("[data-memory-translation-status]").hidden, true);
        assert.equal(state.requests.filter(request => request.url.endsWith("/translate")).length, 1);
    }
});

test("a provider disabled while display processing is pending cannot replace the original content", async () => {
    let finish: (value: unknown) => void;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: true, count: 1}}; }
        if (url.endsWith("/translate")) { return new Promise(resolve => { finish = resolve; }); }
    }, {translate: true});
    await state.flush();
    state.config.ai.providers[0].enabled = false;
    finish({code: 0, data: {memory: "Translated", language: "zh-CN"}});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "Original");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
});

test("returning to an overview whose pending request was abandoned starts a fresh wait", async () => {
    let reads = 0;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: ++reads === 2 ? "Other" : "Original", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { return new Promise(() => {}); }
    }, {translate: true});
    await state.flush();
    await state.refresh();
    await state.refresh();
    const requests = state.requests.filter(request => request.url.endsWith("/translate"));
    assert.equal(requests.length, 3);
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(requests[1].signal.aborted, true);
    assert.equal(requests[2].signal.aborted, false);
});

test("changing provider configuration or reasoning effort invalidates the display cache even with the same selected ID", async () => {
    let calls = 0;
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {memory: "Original", stale: false, countComplete: false}}; }
        if (url.endsWith("/translate")) { return {code: 0, data: {memory: `Processed ${++calls}`, language: "zh-CN"}}; }
    }, {translate: true});
    await state.flush();
    state.config.ai.providers = state.config.ai.providers.map(provider => ({...provider}));
    await state.refresh();
    assert.equal(calls, 2);
    assert.equal(state.field("[data-memory-overview]").textContent, "Processed 2");
    state.config.ai.memory.reasoningEffort = "high";
    await state.refresh();
    assert.equal(calls, 3);
    assert.equal(state.field("[data-memory-overview]").textContent, "Processed 3");
});

test("memory management presents one action and one overview without count or record-management controls", async () => {
    const state = harness(url => url.endsWith("/overview") ?
        {code: 0, data: {count: 251, countComplete: true, memory: "A unified overview", user: "legacy content", stale: false}} : undefined);
    await state.flush();
    assert.deepEqual([...state.content.matchAll(/data-memory-action="([^"]+)"/g)].map(match => match[1]), ["maintain"]);
    assert.match(state.title, /aiMemorySummary/);
    assert.match(state.title, /data-memory-more[^>]*aria-haspopup="menu"/);
    assert.match(state.title, /#iconMore/);
    assert.doesNotMatch(state.content, /aiMemoryTip|data-memory-(?:task-status|overview-status|model-hint)/);
    assert.doesNotMatch(state.content, /data-memory-(?:count|query|list|detail|pagination|task-choice)|<details|<select/);
    assert.equal(state.field("[data-memory-overview]").textContent, "A unified overview");
    assert.ok(state.content.indexOf("data-memory-overview aria-label") < state.content.indexOf("data-memory-task-input"));
    assert.ok(state.content.indexOf("data-memory-task-input") < state.content.indexOf('data-memory-action="maintain"'));
    assert.match(state.content, /<input type="text"[^>]*data-memory-task-input/);
    assert.doesNotMatch(state.content, /<textarea/);
    assert.equal(state.requests.filter(request => request.url.endsWith("/list")).length, 1);
    assert.equal(state.requests.find(request => request.url.endsWith("/list")).data.limit, 1);
    assert.equal(state.timers.size, 0);
});

test("summary retains the shared typography, compact input and scrollable layout without inline status controls", () => {
    const source = readFileSync("src/ai/memos/manager.ts", "utf8");
    const styles = readFileSync("src/assets/scss/business/_memory-manager.scss", "utf8");
    assert.match(styles, /&__content\s*\{\s*max-height:\s*min\(360px, 40vh\);\s*overflow:\s*auto;/);
    assert.match(source, /<div class="memory-manager__content b3-typography"/);
    assert.doesNotMatch(source, /countStatus|aiMemoryRememberedCount|aiMemoryCountUnavailable/);
    assert.match(styles, /&__actions\s*\{[^}]*justify-content:\s*flex-end;/);
    assert.doesNotMatch(styles, /\btextarea\b|\bresize\s*:/);
    assert.doesNotMatch(styles, /min-height:\s*96px/);
    assert.doesNotMatch(styles, /&__(?:record|list|detail|field|empty)\b/);
});

test("stale overviews hide obsolete facts without claiming ongoing processing", async () => {
    const state = harness(url => url.endsWith("/overview") ?
        {code: 0, data: {count: 0, countComplete: false, memory: "withdrawn fact", stale: true}} : undefined);
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
    assert.deepEqual([...state.timers.values()].map(timer => timer.delay), [30000]);
});

test("an empty stale overview with no model has no inline status or endless loading spinner", async () => {
    const state = harness(url => url.endsWith("/overview") ?
        {code: 0, data: {memory: "", stale: true, count: 0, countComplete: true}} : undefined, {configured: false});
    await state.flush();
    assert.equal(state.field("[data-memory-overview]").textContent, "");
    assert.equal(state.field("[data-memory-translation-status]").hidden, true);
    assert.equal(state.field("[data-memory-loading]").hidden, true);
    assert.equal(state.button.attributes.get("aria-busy"), "false");
    assert.equal(state.messages.length, 1);
    state.input.listeners.get("focus")();
    assert.equal(state.messages.length, 1);
    state.destroy();
    state.input.listeners.get("focus")();
    assert.equal(state.messages.length, 1);
});

test("read-only and unconfigured workspaces never submit a model task", async () => {
    for (const options of [{readonly: true}, {configured: false}]) {
        const state = harness(undefined, options);
        await state.flush();
        state.enter("Remember this");
        await state.click();
        assert.equal(state.button.disabled, true);
        assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
        if (options.configured === false) {
            assert.match(state.button.title, /aiSelectModel.*config.*aiMemory/);
            assert.equal(state.messages.length, 1);
        }
        state.destroy();
    }
});

test("empty input stays silent and pending submission cannot be duplicated or closed", async () => {
    let accept: (response: unknown) => void;
    const state = harness(url => url.endsWith("/maintain") ? new Promise(resolve => {accept = resolve;}) :
        url.endsWith("/task") ? completed() : undefined);
    await state.flush();
    state.enter("   ");
    await state.click();
    assert.equal(state.requests.some(request => request.url.endsWith("/maintain")), false);
    assert.deepEqual(state.messages, []);
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

test("completed tasks refresh the summary without count polling or result notifications", async () => {
    const state = harness(url => {
        if (url.endsWith("/overview")) { return {code: 0, data: {count: 7, countComplete: false, memory: "Summary", stale: false}}; }
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) { return completed("task", [{id: "candidate-internal", saved: true}]); }
    });
    await state.flush();
    assert.equal(state.timers.size, 0);
    state.enter("A correction");
    await state.click();
    assert.deepEqual(state.messages, []);
    assert.equal(state.field("[data-memory-overview]").textContent, "Summary");
    assert.equal(state.requests.filter(request => request.url.endsWith("/overview")).length, 2);
    assert.equal(state.timers.size, 0);
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
    assert.match(state.messages[0], /offline/);
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

test("the shared spinner follows submission and running state; repeated errors show one escaped notification", async () => {
    let reads = 0;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "task"}}; }
        if (url.endsWith("/task")) {
            if (++reads < 3) { throw new Error("<img src=x onerror=bad>"); }
            return completed();
        }
    });
    await state.flush();
    assert.match(state.content, /class="b3-loading b3-loading--small" data-memory-loading/);
    assert.equal(state.field("[data-memory-loading]").hidden, true);
    state.enter("Remember this");
    await state.click();
    assert.equal(state.field("[data-memory-loading]").hidden, false);
    await state.tick(2000);
    assert.equal(state.messages.length, 1);
    assert.match(state.messages[0], /&lt;img/);
    assert.doesNotMatch(state.messages[0], /<img/);
    await state.tick(4000);
    assert.equal(state.field("[data-memory-loading]").hidden, true);
});

test("completion loads the fresh overview with only a spinner and no result notification", async () => {
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
    assert.equal(state.field("[data-memory-translation-status]").hidden, false);
    assert.deepEqual(state.messages, []);
    finishOverview({code: 0, data: {count: 1, countComplete: true, memory: "New memory", stale: false}});
    await state.flush();
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

test("a terminal unavailable task is still notified after an earlier transient query error", async () => {
    let reads = 0;
    const state = harness(url => {
        if (url.endsWith("/maintain")) { return {code: 0, data: {taskId: "gone"}}; }
        if (url.endsWith("/task")) {
            if (++reads === 1) { throw new Error("offline"); }
            return {code: -1, msg: "memory task unavailable; retry explicitly"};
        }
    });
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.match(state.messages[0], /offline/);
    await state.tick(2000);
    assert.equal(state.messages[1], "memory task unavailable; retry explicitly");
    assert.equal(state.messages.length, 2);
    assert.equal(state.button.disabled, false);
    assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
    assert.equal(state.timers.size, 0);
});

test("cancelled backend tasks notify their error but a cancellation without an error stays silent", async () => {
    for (const error of ["Source changed", ""]) {
        const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "cancelled"}} :
            url.endsWith("/task") ? {code: 0, data: {taskId: "cancelled", state: "cancelled", error}} : undefined);
        await state.flush();
        state.enter("Remember this");
        await state.click();
        assert.deepEqual(state.messages, error ? ["embeddingFailed"] : []);
        assert.equal(state.button.disabled, false);
        assert.equal(state.field("[data-memory-loading]").hidden, true);
        assert.equal(state.requests.some(request => request.url.endsWith("/cancel")), false);
    }
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

test("overview read failures recover automatically without a count placeholder", async () => {
    let attempts = 0;
    const state = harness(url => {
        if (url.endsWith("/overview")) {
            if (++attempts === 1) { throw new Error("offline"); }
            return {code: 0, data: {count: 3, countComplete: true, memory: "Valid summary", stale: false}};
        }
    });
    await state.flush();
    assert.match(state.messages[0], /offline/);
    await state.tick(2000);
    assert.equal(state.field("[data-memory-overview]").textContent, "Valid summary");
    assert.equal(state.timers.size, 0);
});

test("initial task discovery recovers before permitting another model request", async () => {
    let attempts = 0;
    const state = harness(url => {
        if (url.endsWith("/list")) {
            if (++attempts === 1) { throw new Error("offline"); }
            return {code: 0, data: {tasks: [{taskId: "old-failure", state: "failed"}, {taskId: "already-running", state: "running"}]}};
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

test("opening the summary ignores terminal history instead of replaying old task errors", async () => {
    for (const phase of ["failed", "cancelled", "completed"]) {
        const state = harness(url => url.endsWith("/list") ? {code: 0, data: {tasks: [{taskId: "old", state: phase}]}} :
            url.endsWith("/task") ? {code: 0, data: {taskId: "old", state: phase, error: "memory configuration changed; retry explicitly", results: []}} : undefined);
        await state.flush();
        assert.deepEqual(state.messages, []);
        assert.equal(state.requests.some(request => request.url.endsWith("/task")), false);
        assert.equal(state.button.disabled, false);
        assert.equal(state.timers.size, 0);
    }
});

test("an owned task finishing while closed reports its failure once when reopened", async () => {
    let phase = "running";
    const state = harness(url => url.endsWith("/maintain") ? {code: 0, data: {taskId: "owned"}} :
        url.endsWith("/task") ? {code: 0, data: {taskId: "owned", state: phase, error: phase === "failed" ? "memory configuration changed; retry explicitly" : ""}} :
            url.endsWith("/list") ? {code: 0, data: {tasks: [{taskId: "owned", state: phase}]}} : undefined);
    await state.flush();
    state.enter("Remember this");
    await state.click();
    state.destroy();
    phase = "failed";
    state.reopen();
    await state.flush();
    assert.deepEqual(state.messages, ["aiMemoryContentChanged"]);
    assert.equal(state.button.disabled, false);
    state.destroy();
    const polls = state.requests.filter(request => request.url.endsWith("/task")).length;
    state.reopen();
    await state.flush();
    assert.equal(state.requests.filter(request => request.url.endsWith("/task")).length, polls);
    assert.deepEqual(state.messages, ["aiMemoryContentChanged"]);
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


test("a rejected changed configuration starts a fresh identity only on the next explicit click", async () => {
    const state = harness(url => url.endsWith("/maintain") ?
        {code: -1, msg: "memory task input changed; start a new task"} : undefined);
    await state.flush();
    state.enter("Remember this");
    await state.click();
    assert.equal(state.requests.filter(request => request.url.endsWith("/maintain")).length, 1);
    await state.click();
    const submits = state.requests.filter(request => request.url.endsWith("/maintain"));
    assert.equal(submits.length, 2);
    assert.notEqual(submits[0].data.operationId, submits[1].data.operationId);
});
