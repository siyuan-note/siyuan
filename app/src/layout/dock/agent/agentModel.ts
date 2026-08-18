export interface AgentModelOption {
    id: string;
    name: string;
}

interface AgentModelConfig {
    providers?: Array<{
        enabled: boolean;
        models: Array<{
            id: string;
            enabled: boolean;
            name: string;
            displayName?: string;
        }>;
    }>;
    agent?: {
        modelId?: string;
    };
}

export const getUsableAgentModels = (aiConfig: AgentModelConfig): AgentModelOption[] => {
    const options: AgentModelOption[] = [];
    for (const provider of aiConfig.providers || []) {
        if (!provider.enabled) {
            continue;
        }
        for (const model of provider.models) {
            if (!model.enabled) {
                continue;
            }
            const name = model.displayName || model.name;
            if (name) {
                options.push({id: model.id || model.name, name});
            }
        }
    }
    return options;
};

export const getAgentDefaultModelID = (aiConfig: AgentModelConfig, options: AgentModelOption[]): string => {
    const configuredModelID = aiConfig.agent?.modelId || "";
    if (configuredModelID && options.some(option => option.id === configuredModelID)) {
        return configuredModelID;
    }
    return options[0]?.id || "";
};
