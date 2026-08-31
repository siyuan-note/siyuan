const cloneSearchConfig = (config: Config.IUILayoutTabSearchConfig) => {
    return JSON.parse(JSON.stringify(config)) as Config.IUILayoutTabSearchConfig;
};

export const resolveGlobalSearchScope = (config: Config.IUILayoutTabSearchConfig) => {
    if (config.removed) {
        return {
            hPath: "",
            idPath: [] as string[],
        };
    }
    return {
        hPath: config.hPath || "",
        idPath: [...(config.idPath || [])],
    };
};

export const resolveSearchConfigUpdate = (options: {
    selectedConfig: Config.IUILayoutTabSearchConfig,
    currentConfig: Config.IUILayoutTabSearchConfig,
    useCurrentPath: boolean,
    persistedConfig?: Config.IUILayoutTabSearchConfig,
}) => {
    const runtimeConfig = cloneSearchConfig(options.selectedConfig);
    if (options.useCurrentPath) {
        runtimeConfig.hPath = options.currentConfig.hPath || "";
        runtimeConfig.idPath = [...(options.currentConfig.idPath || [])];
    }
    return {
        runtimeConfig,
        persistedConfig: cloneSearchConfig(options.persistedConfig || options.selectedConfig),
    };
};
