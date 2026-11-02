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
