import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

class ControlStub {
    value = "";
    disabled = false;
    innerHTML = "";
    textContent = "";
    listeners = new Map<string, () => void>();
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
}

test("memory settings expose one enable switch without changing defaults", () => {
    const switches: string[] = [];
    const memory = {enabled: false, modelId: "", reasoningEffort: ""};
    const code = transpileModule(readFileSync("src/config/tabs/ai/aiMemory.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exported = {} as {registerAiMemoryGroup: (tab: unknown) => void};
    let writes = 0;
    let html = "";
    runInNewContext(code, {
        exports: exported,
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {ai: {memory}}}},
        require: (name: string) => name.endsWith("/aiRuntime") ? {aiConfigApi: {patch: () => { writes++; }}} : {},
    });
    exported.registerAiMemoryGroup({group: () => ({
        switch: (id: string) => switches.push(id),
        slot: (spec: {html: () => string}) => { html = spec.html(); }, button: () => {},
    })});
    assert.deepEqual(switches, ["ai.memory.enabled"]);
    assert.equal(writes, 0);
    assert.ok(!html.includes("data-memory-sources"));
    assert.ok(html.includes("data-memory-model"));
    assert.ok(html.includes("data-memory-effort"));
    assert.equal(memory.modelId, "");
    assert.equal(memory.enabled, false);
});

test("model selection preserves queued opt-outs without fetching or selecting notebooks", async () => {
    const memory = {enabled: true, modelId: "old", reasoningEffort: ""};
    const model = new ControlStub();
    const effort = new ControlStub();
    const requests: string[] = [];
    const root = {isConnected: true, querySelector: (selector: string) => selector.includes("model") ? model : selector.includes("effort") ? effort : null};
    let mount: (root: unknown) => void;
    const patches: Array<{path: string; value: Record<string, unknown>; finish: () => void}> = [];
    const patch = (path: string, value: Record<string, unknown>, applied?: () => void) => {
        let resolve: () => void;
        const pending = new Promise<void>(done => { resolve = done; });
        patches.push({path, value, finish: resolve});
        return pending.then(() => {
            if (path === "memory") { Object.assign(memory, value); }
            applied?.();
        });
    };
    const code = transpileModule(readFileSync("src/config/tabs/ai/aiMemory.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exported = {} as {registerAiMemoryGroup: (tab: unknown) => void};
    runInNewContext(code, {
        exports: exported,
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {ai: {memory, providers: new Array<string>()}}}},
        document: {createElement: () => new ControlStub()},
        require: (name: string) => {
            if (name.endsWith("/aiRuntime")) { return {aiConfigApi: {patch}}; }
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr: String}; }
            if (name.endsWith("/state")) { return {memoryModelOptions: () => new Array<{id: string; label: string}>()}; }
            if (name.endsWith("/reasoningEffort")) { return {getReasoningEffortOptions: () => [{value: "", label: "default"}]}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: async (url: string) => {
                requests.push(url);
                assert.equal(url, "/api/ai/memory/capabilities");
                return {code: 0, data: {efforts: new Array<string>()}};
            }}; }
            if (name.endsWith("/message")) { return {showMessage: (error: string) => { throw new Error(error); }}; }
            return {};
        },
    });
    exported.registerAiMemoryGroup({group: () => ({switch: () => {}, button: () => {}, slot: (spec: {afterMount: (root: unknown) => void}) => { mount = spec.afterMount; }})});
    mount(root);
    const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); } };
    await flush();
    model.value = "new";
    model.listeners.get("change")();
    assert.equal(effort.disabled, true);
    effort.value = "old-model-only";
    effort.listeners.get("change")();
    assert.equal(patches.length, 1, "old model effort cannot be queued during model change");
    assert.deepEqual(Object.keys(patches[0].value).sort(), ["modelId", "reasoningEffort"]);
    memory.enabled = false;
    patches[0].finish();
    await flush();
    assert.equal(memory.enabled, false);
    assert.ok(requests.length > 0);
    assert.ok(requests.every(url => url === "/api/ai/memory/capabilities"));
    assert.equal(patches.length, 1);
});
