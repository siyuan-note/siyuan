interface IPluginDockShowState {
    type: string,
    show: boolean,
}

export interface IPluginDockPlacementState {
    type: string,
    position: TPluginDockPosition,
    index: number,
    size?: Partial<Config.IUILayoutDockPanelSize>,
}

interface IPluginDockOwner {
    name: string,
    docks: Record<string, {
        config: IPluginDockTab,
    }>,
}

type TPluginDockStorage = Record<string, Record<string, IPluginDockTab>>;

const ensurePluginDockConfig = (
    type: string,
    plugins: IPluginDockOwner[],
    storage: TPluginDockStorage,
) => {
    const plugin = plugins.find((item) => Object.prototype.hasOwnProperty.call(item.docks, type));
    if (!plugin) {
        return;
    }
    let initialized = false;
    if (!storage[plugin.name]) {
        storage[plugin.name] = {};
        initialized = true;
    }
    if (!storage[plugin.name][type]) {
        storage[plugin.name][type] = plugin.docks[type].config;
        initialized = true;
    }
    return {
        config: storage[plugin.name][type],
        initialized,
    };
};

export const updatePluginDockShowStates = (
    states: IPluginDockShowState[],
    plugins: IPluginDockOwner[],
    storage: TPluginDockStorage,
) => {
    let changed = false;
    states.forEach((state) => {
        const dock = ensurePluginDockConfig(state.type, plugins, storage);
        if (!dock) {
            return;
        }
        changed = dock.initialized || changed;
        const config = dock.config;
        if (config.show !== state.show) {
            config.show = state.show;
            changed = true;
        }
    });
    return changed;
};

export const updatePluginDockPlacements = (
    states: IPluginDockPlacementState[],
    plugins: IPluginDockOwner[],
    storage: TPluginDockStorage,
) => {
    let changed = false;
    states.forEach((state) => {
        const dock = ensurePluginDockConfig(state.type, plugins, storage);
        if (!dock) {
            return;
        }
        changed = dock.initialized || changed;
        const config = dock.config;
        if (config.position !== state.position) {
            config.position = state.position;
            changed = true;
        }
        if (config.index !== state.index) {
            config.index = state.index;
            changed = true;
        }
        if (state.size) {
            (Object.keys(state.size) as (keyof Config.IUILayoutDockPanelSize)[]).forEach((key) => {
                const value = state.size[key];
                if (typeof value !== "undefined" && config.size[key] !== value) {
                    config.size[key] = value;
                    changed = true;
                }
            });
        }
    });
    return changed;
};
