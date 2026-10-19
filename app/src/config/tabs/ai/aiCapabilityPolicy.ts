export type AgentApprovalDecision = "risk" | "allow" | "confirm";
export type AgentActionApprovalDecision = "" | AgentApprovalDecision;
export type CapabilityDecision = "allow" | "deny";

export interface IAgentApprovalOverride {
    default: string;
    actions: Record<string, string>;
}

export interface IAgentApprovalPolicy {
    default: string;
    overrides: Record<string, IAgentApprovalOverride>;
}

// 补丁只携带本次改动的键，其余覆盖项由设置补丁的合并保留。
export interface IAgentApprovalOverridePatch {
    default?: string;
    actions?: Record<string, string>;
}

export const resolveCapabilityApproval = (policy: IAgentApprovalPolicy, id: string, action = ""): string => {
    const override = policy.overrides[id];
    return override?.actions[action] || override?.default || policy.default;
};

export const getCapabilityActionApproval = (policy: IAgentApprovalPolicy, id: string, action: string):
    string => policy.overrides[id]?.actions[action] || "";

// 能力开关只提交本次改动的条目；恢复默认时写入空决策，由内核规范化清除。
export const capabilityOverridesPatch = (policyDefault: string, ids: string[], decision: CapabilityDecision):
    Record<string, string> => {
    const overrides: Record<string, string> = {};
    ids.forEach((id) => {
        overrides[id] = decision === policyDefault ? "" : decision;
    });
    return overrides;
};

// 能力审批方式只提交该能力的默认决策，已有的操作决策由合并保留。
export const approvalOverridePatch = (policyDefault: string, decision: AgentApprovalDecision):
    IAgentApprovalOverridePatch => ({default: decision === policyDefault ? "" : decision});

// 单个操作的审批方式只提交该操作，空决策表示跟随能力设置。
export const actionApprovalPatch = (action: string, decision: AgentActionApprovalDecision):
    IAgentApprovalOverridePatch => ({actions: {[action]: decision}});
