import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {getAgentReasoningEffortOptions} from "./AgentReasoning";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentReasoning.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPreference = (values = new Map<string, string>(), unavailable = false) => {
    const exports = {} as typeof import("./AgentReasoning");
    runInNewContext(compiled, {
        exports,
        window: {
            localStorage: {
                getItem: (key: string) => {
                    if (unavailable) {
                        throw new Error("Storage unavailable");
                    }
                    return values.get(key) ?? null;
                },
                setItem: (key: string, value: string) => {
                    if (unavailable) {
                        throw new Error("Storage unavailable");
                    }
                    values.set(key, value);
                },
            },
        },
    });
    return {...exports, values};
};

describe("AgentReasoning", () => {
    it("restores every saved effort after reinitialization, including default and none", () => {
        const preference = createPreference();
        for (const {value} of getAgentReasoningEffortOptions({}).reverse()) {
            preference.setAgentReasoningEffort(value);
            assert.equal(createPreference(preference.values).getAgentReasoningEffort(), value);
        }
        assert.equal(preference.values.size, 1);
    });

    it("defaults missing or invalid preferences without overwriting storage", () => {
        const preference = createPreference();
        assert.equal(preference.getAgentReasoningEffort(), "");
        for (const value of ["invalid", "HIGH", "null", "undefined"]) {
            preference.values.set(preference.AGENT_REASONING_EFFORT_KEY, value);
            assert.equal(preference.getAgentReasoningEffort(), "");
            assert.equal(preference.values.get(preference.AGENT_REASONING_EFFORT_KEY), value);
        }
    });

    it("tolerates unavailable storage", () => {
        const preference = createPreference(new Map(), true);
        assert.equal(preference.getAgentReasoningEffort(), "");
        assert.doesNotThrow(() => preference.setAgentReasoningEffort("high"));
    });

    it("provides every supported reasoning effort value", () => {
        const options = getAgentReasoningEffortOptions({});
        assert.deepEqual(options.map(option => option.value), [
            "",
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        ]);
    });

    it("uses localized labels when available", () => {
        const options = getAgentReasoningEffortOptions({
            reasoningEffortDefault: "default-label",
            reasoningEffortNone: "none-label",
            reasoningEffortLow: "low-label",
            reasoningEffortMedium: "medium-label",
            reasoningEffortHigh: "high-label",
            reasoningEffortXHigh: "xhigh-label",
            reasoningEffortMax: "max-label",
        });
        assert.deepEqual(options.map(option => option.label), [
            "default-label",
            "none-label",
            "low-label",
            "medium-label",
            "high-label",
            "xhigh-label",
            "max-label",
        ]);
    });
});
