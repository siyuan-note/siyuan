import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getReasoningEffortOptions} from "../../../ai/reasoningEffort";

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

test("memory model placeholder preserves empty selection and model changes preserve queued opt-outs", async () => {
    const memory = {enabled: true, modelId: "old", reasoningEffort: ""};
    const languages = JSON.parse(readFileSync("appearance/langs/zh-CN.json", "utf8"));
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
        window: {siyuan: {languages, config: {ai: {memory, providers: new Array<string>()}}}},
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
    assert.equal(model.value, "old");
    memory.modelId = "";
    model.listeners.get("focus")();
    assert.equal(model.innerHTML, '<option value="">请选择模型</option>');
    assert.equal(model.value, "");
    assert.equal(memory.modelId, "");
    assert.equal(patches.length, 0, "rendering an unconfigured model does not save a selection");
    model.listeners.get("focus")();
    assert.equal(model.innerHTML, '<option value="">请选择模型</option>');
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
    assert.equal(model.value, "new");
    assert.equal(memory.reasoningEffort, "");
    assert.equal(memory.enabled, false);
    assert.ok(requests.length > 0);
    assert.ok(requests.every(url => url === "/api/ai/memory/capabilities"));
    assert.equal(patches.length, 1);
});


test("memory reasoning uses Agent options and saves, resets, and reloads model selections", async () => {
    const options = getReasoningEffortOptions({});
    const memory = {modelId: "deepseek-flash", reasoningEffort: "high"};
    const model = new ControlStub();
    const effort = new ControlStub();
    const root = {isConnected: true, querySelector: (selector: string) => selector.includes("model") ? model : effort};
    const patches: Array<{path: string; value: unknown}> = [];
    const responses: Array<(value: unknown) => void> = [];
    let mount: (root: unknown) => void;
    const exported = {} as {registerAiMemoryGroup: (tab: unknown) => void};
    runInNewContext(transpileModule(readFileSync("src/config/tabs/ai/aiMemory.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {
        exports: exported,
        window: {siyuan: {languages: {}, config: {ai: {memory, providers: []}}}},
        require: (name: string) => {
            if (name.endsWith("/aiRuntime")) { return {aiConfigApi: {patch: async (path: string, value: unknown) => {
                patches.push({path, value});
                if (path === "memory") { Object.assign(memory, value); }
                if (path === "memory.reasoningEffort") { memory.reasoningEffort = value as string; }
            }}}; }
            if (name.endsWith("/escape")) { return {escapeHtmlTextAndAttr: String}; }
            if (name.endsWith("/state")) { return {memoryModelOptions: () => [
                {id: "deepseek-flash", label: "DeepSeek / deepseek-flash"},
                {id: "claude-opus-4-6", label: "Anthropic / claude-opus-4-6"},
            ]}; }
            if (name.endsWith("/reasoningEffort")) { return {getReasoningEffortOptions}; }
            if (name.endsWith("/fetch")) { return {fetchSyncPost: () => new Promise(resolve => responses.push(resolve))}; }
            if (name.endsWith("/message")) { return {showMessage: (error: string) => { throw new Error(error); }}; }
            return {};
        },
    });
    exported.registerAiMemoryGroup({group: () => ({switch: () => {}, button: () => {}, slot: (spec: {afterMount: (root: unknown) => void}) => { mount = spec.afterMount; }})});
    const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); } };
    const complete = async () => {
        responses.shift()({code: 0, data: {efforts: options.filter(option => option.value).map(option => option.value)}});
        await flush();
    };
    mount(root);
    assert.equal(effort.disabled, true);
    await complete();
    assert.equal(effort.disabled, false, "DeepSeek must not be blocked by a model-name whitelist");
    assert.equal(effort.value, "high");
    assert.equal(effort.innerHTML, options.map(option => `<option value="${option.value}">${option.label}</option>`).join(""));
    for (const {value} of options) {
        effort.value = value;
        effort.listeners.get("change")();
        await flush();
        assert.equal(memory.reasoningEffort, value);
        assert.equal(patches.at(-1).path, "memory.reasoningEffort");
    }
    model.value = "claude-opus-4-6";
    model.listeners.get("change")();
    assert.equal(effort.disabled, true);
    await flush();
    await complete();
    assert.equal(memory.modelId, "claude-opus-4-6");
    assert.equal(memory.reasoningEffort, "");
    assert.equal(effort.value, "");
    assert.equal(effort.disabled, false);
    effort.value = "xhigh";
    effort.listeners.get("change")();
    await flush();
    mount(root);
    await complete();
    assert.equal(effort.value, "xhigh", "saved reasoning is restored on remount");
    model.value = "";
    model.listeners.get("change")();
    await flush();
    responses.shift()({code: 0, data: {efforts: []}});
    await flush();
    assert.equal(memory.modelId, "");
    assert.equal(memory.reasoningEffort, "");
    assert.equal(effort.disabled, true, "unconfigured model stays disabled without fallback");
});
