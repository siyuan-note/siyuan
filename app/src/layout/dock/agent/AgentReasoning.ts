export type AgentReasoningEffort = "" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

export const AGENT_REASONING_EFFORT_KEY = "siyuan-agent-reasoning-effort";

export const getAgentReasoningEffort = (): AgentReasoningEffort => {
    try {
        const value = window.localStorage.getItem(AGENT_REASONING_EFFORT_KEY);
        return getAgentReasoningEffortOptions({}).find(option => option.value === value)?.value ?? "";
    } catch (e) {
        return "";
    }
};

export const setAgentReasoningEffort = (value: AgentReasoningEffort): void => {
    try {
        window.localStorage.setItem(AGENT_REASONING_EFFORT_KEY, value);
    } catch (e) {
        // 存储不可用时，当前聊天实例仍可使用所选思考等级。
    }
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
