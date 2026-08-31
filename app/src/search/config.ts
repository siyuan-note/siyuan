const temporaryPathConfigs = new WeakSet<Config.IUILayoutTabSearchConfig>();
const searchPathRequestVersions = new WeakMap<object, number>();

export const nextSearchPathRequestVersion = (target: object) => {
    const version = (searchPathRequestVersions.get(target) || 0) + 1;
    searchPathRequestVersions.set(target, version);
    return version;
};

export const isSearchPathRequestVersionCurrent = (target: object, version: number) => {
    return searchPathRequestVersions.get(target) === version;
};

export const hasExplicitSearchScope = (options: {
    notebookId?: string,
    notebookIds?: string[],
}) => {
    return Boolean(options.notebookId || options.notebookIds?.length);
};

export const setSearchConfigTemporaryPath = (config: Config.IUILayoutTabSearchConfig, temporary: boolean) => {
    if (temporary) {
        temporaryPathConfigs.add(config);
    } else {
        temporaryPathConfigs.delete(config);
    }
};

export const hasSearchConfigTemporaryPath = (config: Config.IUILayoutTabSearchConfig) => {
    return temporaryPathConfigs.has(config);
};

const normalizeSearchPath = (value: string) => {
    return value.replace(/\\/g, "/").replace(/\.sy$/, "").replace(/^\/+|\/+$/g, "");
};

export const getSearchPathID = (path: string) => {
    return normalizeSearchPath(path).split("/").pop() || "";
};

export const resolveSearchNotebookHPath = (path: string, notebooks: {id: string, name: string}[],
                                           notebookNames: Record<string, string> = {}) => {
    const id = getSearchPathID(path);
    const notebook = notebooks.find((item) => item.id === id);
    if (notebook) {
        return notebookNames[id] || notebook.name;
    }
};

export const isCurrentSearchPath = (searchPath: string, notebookId: string, path: string) => {
    const normalizedSearchPath = normalizeSearchPath(searchPath);
    const normalizedNotebookId = normalizeSearchPath(notebookId);
    if (normalizedSearchPath.includes("/")) {
        return normalizedSearchPath === `${normalizedNotebookId}/${normalizeSearchPath(path)}`;
    }
    return normalizedSearchPath === normalizedNotebookId || normalizedSearchPath === getSearchPathID(path);
};

export const isSearchPathAffectedByRename = (idPath: string[], notebookId: string, path: string, id?: string) => {
    const renamedPath = `${normalizeSearchPath(notebookId)}/${normalizeSearchPath(path)}`;
    const renamedId = typeof id === "string" ? normalizeSearchPath(id) : getSearchPathID(path);
    return idPath.some((item) => {
        const normalizedPath = normalizeSearchPath(item);
        return (renamedId !== "" && normalizedPath === renamedId) || normalizedPath === renamedPath ||
            normalizedPath.startsWith(`${renamedPath}/`);
    });
};

export const isSearchPathAffectedByNotebookRename = (idPath: string[], notebookId: string) => {
    const normalizedNotebookId = normalizeSearchPath(notebookId);
    return idPath.some((item) => {
        const normalizedPath = normalizeSearchPath(item);
        return normalizedPath === normalizedNotebookId || normalizedPath.startsWith(`${normalizedNotebookId}/`);
    });
};

export const isSameSearchPath = (path: string[], targetPath: string[]) => {
    return path.length === targetPath.length && path.every((item, index) => item === targetPath[index]);
};

export const syncSearchConfigHPath = (target: Config.IUILayoutTabSearchConfig,
                                      source: Config.IUILayoutTabSearchConfig) => {
    if (!isSameSearchPath(target.idPath || [], source.idPath || [])) {
        return false;
    }
    target.hPath = source.hPath;
    return true;
};

export const resolveSearchHPath = async (idPath: string[],
                                         resolvePath: (path: string) => Promise<string | undefined>) => {
    if (idPath.length === 0) {
        return;
    }
    let hPaths: (string | undefined)[];
    try {
        hPaths = await Promise.all(idPath.map((item) => resolvePath(item)));
    } catch {
        return;
    }
    if (hPaths.some((item) => typeof item !== "string" || item === "")) {
        return;
    }
    return hPaths.join(" ");
};

export const refreshSearchConfigHPath = async (options: {
    config: Config.IUILayoutTabSearchConfig,
    resolveHPath: (idPath: string[]) => Promise<string | undefined>,
    isCurrent?: () => boolean,
    render?: (hPath: string) => void,
}) => {
    const idPath = [...(options.config.idPath || [])];
    if (idPath.length === 0) {
        return false;
    }
    let hPath: string | undefined;
    try {
        hPath = await options.resolveHPath(idPath);
    } catch {
        return false;
    }
    if (!hPath || !isSameSearchPath(idPath, options.config.idPath || []) || options.isCurrent && !options.isCurrent()) {
        return false;
    }
    options.config.hPath = hPath;
    options.render?.(hPath);
    return true;
};

export const cloneSearchConfig = (config: Config.IUILayoutTabSearchConfig) => {
    return JSON.parse(JSON.stringify(config)) as Config.IUILayoutTabSearchConfig;
};

export const syncSearchConfig = (target: Config.IUILayoutTabSearchConfig,
                                 source: Config.IUILayoutTabSearchConfig) => {
    Object.keys(target).forEach((key) => {
        Reflect.deleteProperty(target, key);
    });
    Object.assign(target, cloneSearchConfig(source));
    return target;
};

export const resolveSearchConfig = (nextConfig: Config.IUILayoutTabSearchConfig,
                                    currentConfig: Config.IUILayoutTabSearchConfig,
                                    preserveCurrentPath: boolean) => {
    const persistedConfig = cloneSearchConfig(nextConfig);
    const effectiveConfig = cloneSearchConfig(nextConfig);
    if (preserveCurrentPath) {
        effectiveConfig.hPath = currentConfig.hPath || "";
        effectiveConfig.idPath = [...(currentConfig.idPath || [])];
    }
    return {
        effectiveConfig,
        persistedConfig,
    };
};

export const replaceSearchConfigPath = (config: Config.IUILayoutTabSearchConfig,
                                        pathConfig: Config.IUILayoutTabSearchConfig) => {
    const result = cloneSearchConfig(config);
    result.hPath = pathConfig.hPath || "";
    result.idPath = [...(pathConfig.idPath || [])];
    return result;
};

export const resolvePersistedSearchConfig = (effectiveConfig: Config.IUILayoutTabSearchConfig,
                                             previousConfig: Config.IUILayoutTabSearchConfig,
                                             hasTemporaryPath: boolean) => {
    if (!hasTemporaryPath) {
        return cloneSearchConfig(effectiveConfig);
    }
    if (effectiveConfig.removed) {
        return replaceSearchConfigPath(effectiveConfig, {
            hPath: "",
            idPath: [],
        });
    }
    return replaceSearchConfigPath(effectiveConfig, previousConfig);
};

export const getGlobalSearchPath = (config: Config.IUILayoutTabSearchConfig) => {
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

export const resolveGlobalSearchScope = getGlobalSearchPath;

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
