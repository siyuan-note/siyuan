export type AgentApprovalDecision = "risk" | "allow" | "confirm";
export type AgentActionApprovalDecision = "" | AgentApprovalDecision;

export interface IAgentApprovalPolicy {
    default: "risk" | "allow";
    overrides: Record<string, {
        default: AgentActionApprovalDecision;
        actions: Record<string, AgentApprovalDecision>;
    }>;
}

export const resolveCapabilityApproval = (policy: IAgentApprovalPolicy, id: string, action = ""): AgentApprovalDecision => {
    const override = policy.overrides[id];
    return override?.actions[action] || override?.default || policy.default;
};

export const getCapabilityActionApproval = (policy: IAgentApprovalPolicy, id: string, action: string):
    AgentActionApprovalDecision => policy.overrides[id]?.actions[action] || "";

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
