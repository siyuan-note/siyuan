export type AgentApprovalDecision = "risk" | "allow" | "confirm";
export type AgentActionApprovalDecision = "" | AgentApprovalDecision;

export interface IAgentApprovalOverride {
    default: string;
    actions: Record<string, string>;
}

export interface IAgentApprovalPolicy {
    default: string;
    overrides: Record<string, IAgentApprovalOverride>;
}

export const resolveCapabilityApproval = (policy: IAgentApprovalPolicy, id: string, action = ""): string => {
    const override = policy.overrides[id];
    return override?.actions[action] || override?.default || policy.default;
};

export const getCapabilityActionApproval = (policy: IAgentApprovalPolicy, id: string, action: string):
    string => policy.overrides[id]?.actions[action] || "";

export const updateCapabilityApproval = (policy: IAgentApprovalPolicy, id: string,
                                         decision: AgentApprovalDecision): IAgentApprovalPolicy => {
    const overrides = {...policy.overrides};
    const current = overrides[id];
    const actions = {...current?.actions};
    if (decision === policy.default) {
        if (Object.keys(actions).length === 0) {
            delete overrides[id];
        } else {
            overrides[id] = {default: "", actions};
        }
    } else {
        overrides[id] = {default: decision, actions};
    }
    return {...policy, overrides};
};

export const updateCapabilityActionApproval = (policy: IAgentApprovalPolicy, id: string, action: string,
                                               decision: AgentActionApprovalDecision): IAgentApprovalPolicy => {
    const overrides = {...policy.overrides};
    const current = overrides[id];
    const actions = {...current?.actions};
    if (decision === "") {
        delete actions[action];
    } else {
        actions[action] = decision;
    }
    if (!current?.default && Object.keys(actions).length === 0) {
        delete overrides[id];
    } else {
        overrides[id] = {default: current?.default || "", actions};
    }
    return {...policy, overrides};
};

// 设置补丁按对象递归合并，省略的键不会从 overrides 中移除；删除操作改写为空决策，由内核规范化清除。
export const capabilityOverridesForPatch = (current: Record<string, string>,
                                            next: Record<string, string>): Record<string, string> => {
    const overrides = {...next};
    Object.keys(current).forEach((id) => {
        if (!(id in overrides)) {
            overrides[id] = "";
        }
    });
    return overrides;
};

// 审批覆盖项同时包含默认决策和操作决策，整项删除或单个操作删除都改写为空决策。
export const approvalOverridesForPatch = (current: Record<string, IAgentApprovalOverride>,
                                          next: Record<string, IAgentApprovalOverride>):
    Record<string, IAgentApprovalOverride> => {
    const overrides = {...next};
    Object.keys(current).forEach((id) => {
        const nextOverride = overrides[id];
        if (!nextOverride) {
            const actions: Record<string, string> = {};
            Object.keys(current[id].actions).forEach((action) => {
                actions[action] = "";
            });
            overrides[id] = {default: "", actions};
            return;
        }
        const removed = Object.keys(current[id].actions).filter((action) => !(action in nextOverride.actions));
        if (removed.length === 0) {
            return;
        }
        const actions = {...nextOverride.actions};
        removed.forEach((action) => {
            actions[action] = "";
        });
        overrides[id] = {...nextOverride, actions};
    });
    return overrides;
};
