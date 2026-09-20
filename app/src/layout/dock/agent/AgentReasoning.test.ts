import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/layout/dock/agent/AgentReasoning.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const createPreference = (values: Record<string, unknown> = {}, readonly = false) => {
    const exports = {} as typeof import("./AgentReasoning");
    const storage = {...values};
    runInNewContext(compiled, {
        exports,
        require: (id: string) => {
            assert.equal(id, "../../../protyle/util/compatibility");
            return {setStorageVal: (key: string, value: unknown) => {
                if (!readonly) {
                    values[key] = value;
                }
            }};
        },
        window: {
            siyuan: {
                storage,
            },
        },
    });
    return {...exports, values, storage};
};

const getAgentReasoningEffortOptions = createPreference().getAgentReasoningEffortOptions;

describe("AgentReasoning", () => {
    it("restores every saved effort after reinitialization, including default and none", () => {
        const preference = createPreference();
        for (const {value} of getAgentReasoningEffortOptions({}).reverse()) {
            preference.setAgentReasoningEffort(value);
            assert.equal(preference.getAgentReasoningEffort(), value);
            assert.equal(createPreference(preference.values).getAgentReasoningEffort(), value);
        }
        assert.equal(Object.keys(preference.values).length, 1);
    });

    it("defaults missing or invalid preferences without overwriting storage", () => {
        const preference = createPreference();
        assert.equal(preference.getAgentReasoningEffort(), "");
        for (const value of ["invalid", "HIGH", "null", "undefined"]) {
            preference.storage[preference.AGENT_REASONING_EFFORT_KEY] = value;
            assert.equal(preference.getAgentReasoningEffort(), "");
            assert.equal(preference.storage[preference.AGENT_REASONING_EFFORT_KEY], value);
        }
    });

    it("retains the current preference when persistence is skipped in readonly mode", () => {
        const preference = createPreference({}, true);
        assert.equal(preference.getAgentReasoningEffort(), "");
        assert.doesNotThrow(() => preference.setAgentReasoningEffort("high"));
        assert.equal(preference.getAgentReasoningEffort(), "high");
        assert.equal(createPreference(preference.values).getAgentReasoningEffort(), "");
    });

    it("provides every supported reasoning effort value", () => {
        const options = getAgentReasoningEffortOptions({});
        assert.deepEqual(Array.from(options, option => option.value), [
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
        assert.deepEqual(Array.from(options, option => option.label), [
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
