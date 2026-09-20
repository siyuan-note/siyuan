import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {createNamespacePatchQueue} from "../../util/namespacePatchQueue";

test("decision connection testing waits for queued AI saves and detects save failure", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/config/tabs/ai/aiRuntime.ts"), "utf8");
    const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const siyuan = {config: {ai: {decision: {apiKey: "old", name: "jev-latest"}}}};
    type AIConfig = typeof siyuan.config.ai;
    const pending: Array<(success: boolean) => void> = [];
    const moduleExports: {aiConfigApi?: {
        patch: (key: string, value: unknown) => Promise<void>;
        waitForSave: () => Promise<boolean>;
    }} = {};
    runInNewContext(code, {
        exports: moduleExports,
        window: {siyuan, dispatchEvent: () => true},
        CustomEvent: class {},
        require: (name: string) => {
            assert.equal(name, "../../util/namespaceApi");
            return {createConfigNamespaceApi: (options: {
                namespace: string;
                getConfig: () => AIConfig;
                setConfig: (data: AIConfig) => void;
            }) => ({
                apply: options.setConfig,
                patch: createNamespacePatchQueue({
                    namespace: options.namespace,
                    getConfig: options.getConfig,
                    submit: (payload) => new Promise<AIConfig | undefined>(done => {
                        pending.push(success => {
                            if (success) {
                                options.setConfig(payload);
                            }
                            done(success ? payload : undefined);
                        });
                    }),
                }),
            })};
        },
    });
    const api = moduleExports.aiConfigApi;
    assert.equal(await api.waitForSave(), true);
    const keySave = api.patch("decision.apiKey", "new");
    const modelSave = api.patch("decision.name", "jev-test");
    let finished = false;
    void api.waitForSave().then(() => finished = true);
    await new Promise(setImmediate);
    assert.equal(pending.length, 1);
    assert.equal(finished, false);
    pending.shift()(true);
    await keySave;
    await new Promise(setImmediate);
    assert.equal(finished, false);
    assert.equal(siyuan.config.ai.decision.apiKey, "new");
    pending.shift()(false);
    await modelSave;
    assert.equal(await api.waitForSave(), false);
    assert.equal(siyuan.config.ai.decision.name, "jev-latest");
    const retry = api.patch("decision.name", "jev-test");
    await new Promise(setImmediate);
    pending.shift()(true);
    await retry;
    assert.equal(await api.waitForSave(), true);
    assert.equal(siyuan.config.ai.decision.name, "jev-test");
});
