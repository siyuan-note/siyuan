export interface SearchOpenOptions {
    key?: string;
    method?: 0 | 1 | 2 | 3 | 4;
}

export const applySearchOpenOptions = (config: Config.IUILayoutTabSearchConfig, options: SearchOpenOptions) => {
    if (options.key !== undefined) {
        config.k = options.key;
    }
    if (options.method !== undefined) {
        config.method = options.method;
    }
    if (options.key !== undefined || options.method !== undefined) {
        config.page = 1;
    }
};
