import {test} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("shared AI settings place long-term memory last, immediately after rerank", () => {
    const groups: string[] = [];
    const group = new Proxy({}, {get: () => () => {}});
    const tab = {group: (id: string) => { groups.push(id); return group; }};
    const languages = new Proxy({}, {get: (_target, key) => String(key)});
    const requireStub = (name: string): object => {
        if (name === "../../../protyle/util/compatibility") {
            return {isDisabledFeature: () => false};
        }
        if (name === "./aiMemory" || name === "./aiWeb") {
            const exported = {};
            const source = name === "./aiMemory" ? "src/config/tabs/ai/aiMemory.ts" : "src/config/tabs/ai/aiWeb.ts";
            runInNewContext(transpileModule(readFileSync(source, "utf8"), {
                compilerOptions: {module: ModuleKind.CommonJS},
            }).outputText, {
                exports: exported,
                window: {siyuan: {languages, config: {ai: {web: {}}}}},
                require: requireStub,
            });
            return exported;
        }
        return new Proxy({}, {get: () => (): unknown[] => []});
    };
    const exported = {} as {registerAiTab: (tab: unknown) => void};
    runInNewContext(transpileModule(readFileSync("src/config/tabs/ai/aiTab.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: exported, window: {siyuan: {languages}}, require: requireStub});
    exported.registerAiTab(tab);
    assert.deepEqual(groups, [
        "providers", "editing", "agent", "web", "decision", "skills", "imageGeneration",
        "mcp", "mcpOAuth", "embedding", "rerank", "memory",
    ]);
});

test("restricted AI settings expose only the fixed provider's API key", async () => {
    const provider = {id: "deepseek-preview", displayName: "DeepSeek", baseURL: "https://api.deepseek.com",
        apiKey: "", models: [{name: "deepseek-flash"}]};
    const saved: {path: string; value: unknown}[] = [];
    const groups: string[] = [];
    const controls: {desc: string; mode: string; save: (value: string) => Promise<void>}[] = [];
    const exported = {} as {registerAiTab: (tab: unknown) => void};
    const source = readFileSync("src/config/tabs/ai/aiTab.ts", "utf8");
    runInNewContext(transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, {
        exports: exported,
        window: {siyuan: {config: {ai: {providers: [provider]}}, languages: {apiProvider: "Provider", apiKey: "API Key"}}},
        require: (name: string) => {
            if (name === "../../../protyle/util/compatibility") {
                return {isDisabledFeature: (feature: string) => feature === "ai-unrestricted-providers"};
            }
            if (name === "./aiRuntime") {
                return {aiConfigApi: {patch: (path: string, value: unknown) => {
                    saved.push({path, value});
                    return Promise.resolve();
                }}};
            }
            return {};
        },
    });
    exported.registerAiTab({group: (id: string) => {
        groups.push(id);
        return {textBlock: (_id: string, control: typeof controls[0]) => controls.push(control)};
    }});
    assert.deepEqual(groups, ["providers"]);
    assert.equal(controls.length, 1);
    assert.equal(controls[0].mode, "input-password");
    assert.match(controls[0].desc, /deepseek-flash.*https:\/\/api\.deepseek\.com/);
    await controls[0].save("test-input");
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{
        path: "providers", value: [{...provider, apiKey: "test-input"}],
    }]);
});
