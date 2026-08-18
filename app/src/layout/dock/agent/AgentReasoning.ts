export type AgentReasoningEffort = "" | "none" | "low" | "medium" | "high" | "xhigh" | "max";

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
