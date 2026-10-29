import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

class ControlStub {
    value = "";
    disabled = false;
    checked = false;
    innerHTML = "";
    textContent = "";
    children: ControlStub[] = [];
    listeners = new Map<string, () => void>();
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    append(...children: ControlStub[]) { this.children.push(...children); }
    replaceChildren() { this.children = []; }
}

test("memory settings expose independent use, maintenance and conversation permission without changing defaults", () => {
    const switches: string[] = [];
    const memory = {enabled: false, autoMaintain: false, conversations: false, modelId: "", reasoningEffort: "", sources: new Array<string>()};
    const code = transpileModule(readFileSync("src/config/tabs/ai/aiMemory.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    const exported = {} as {registerAiMemoryGroup: (tab: unknown) => void};
    let writes = 0;
    runInNewContext(code, {
        exports: exported,
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)}), config: {ai: {memory}}}},
        require: (name: string) => name.endsWith("/aiRuntime") ? {aiConfigApi: {patch: () => { writes++; }}} : {},
    });
    exported.registerAiMemoryGroup({group: () => ({
        switch: (id: string) => switches.push(id), slot: () => {}, button: () => {},
    })});
    assert.deepEqual(switches, ["ai.memory.enabled", "ai.memory.autoMaintain", "ai.memory.conversations"]);
    assert.equal(writes, 0);
    assert.equal(memory.modelId, "");
    assert.equal(memory.autoMaintain, false);
    assert.equal(memory.conversations, false);
});

test("model selection cannot restore queued opt-outs and source selection serializes acknowledged state", async () => {
    const memory = {enabled: true, autoMaintain: true, conversations: true, modelId: "old", reasoningEffort: "", sources: new Array<string>()};
    const model = new ControlStub();
    const effort = new ControlStub();
    const sources = new ControlStub();
    const root = {isConnected: true, querySelector: (selector: string) => selector.includes("model") ? model : selector.includes("effort") ? effort : sources};
    let mount: (root: unknown) => void;
    const patches: Array<{path: string; value: Record<string, unknown> | string[]; finish: () => void}> = [];
    const patch = (path: string, value: Record<string, unknown> | string[], applied?: () => void) => {
        let resolve: () => void;
        const pending = new Promise<void>(done => { resolve = done; });
        patches.push({path, value, finish: resolve});
        return pending.then(() => {
            if (path === "memory") { Object.assign(memory, value); }
            if (path === "memory.sources") { memory.sources = value as string[]; }
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
            if (name.endsWith("/fetch")) { return {fetchSyncPost: async (url: string) => url.endsWith("capabilities") ?
                {code: 0, data: {efforts: new Array<string>()}} : {code: 0, data: {notebooks: [
                    {id: "A", name: "A", encrypted: false, closed: false}, {id: "B", name: "B", encrypted: false, closed: false},
                ]}}}; }
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
    memory.autoMaintain = false;
    memory.conversations = false;
    patches[0].finish();
    await flush();
    assert.equal(memory.autoMaintain, false);
    assert.equal(memory.conversations, false);
    const a = sources.children[0].children[1];
    const b = sources.children[1].children[1];
    a.checked = true;
    a.listeners.get("change")();
    assert.equal(b.disabled, true);
    b.checked = true;
    b.listeners.get("change")();
    assert.equal(patches.length, 2);
    patches[1].finish();
    await flush();
    assert.equal(b.checked, false);
    assert.equal(b.disabled, false);
    b.checked = true;
    b.listeners.get("change")();
    assert.equal(JSON.stringify(patches[2].value), JSON.stringify(["A", "B"]));
    patches[2].finish();
    await flush();
});
