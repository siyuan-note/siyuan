import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {getAgentReasoningEffortOptions} from "./AgentReasoning";

describe("AgentReasoning", () => {
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
