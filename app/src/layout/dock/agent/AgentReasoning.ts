import {setStorageVal} from "../../../protyle/util/compatibility";

export type AgentReasoningEffort = "" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const AGENT_REASONING_EFFORT_KEY = "siyuan-agent-reasoning-effort";

export const getAgentReasoningEffort = (): AgentReasoningEffort => {
    const value = window.siyuan.storage[AGENT_REASONING_EFFORT_KEY];
    return getAgentReasoningEffortOptions({}).find(option => option.value === value)?.value ?? "";
};

export const setAgentReasoningEffort = (value: AgentReasoningEffort): void => {
    window.siyuan.storage[AGENT_REASONING_EFFORT_KEY] = value;
    setStorageVal(AGENT_REASONING_EFFORT_KEY, value);
};

export const getAgentReasoningEffortOptions = (
    languages: Record<string, string>,
): Array<{ value: AgentReasoningEffort; label: string }> => [
    {value: "", label: languages.reasoningEffortDefault || "Default"},
    {value: "none", label: languages.reasoningEffortNone || "None"},
    {value: "low", label: languages.reasoningEffortLow || "Low"},
    {value: "medium", label: languages.reasoningEffortMedium || "Medium"},
    {value: "high", label: languages.reasoningEffortHigh || "High"},
    {value: "xhigh", label: languages.reasoningEffortXHigh || "Extra high"},
    {value: "max", label: languages.reasoningEffortMax || "Maximum"},
];
