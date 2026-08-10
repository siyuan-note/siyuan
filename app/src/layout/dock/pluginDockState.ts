interface IPluginDockShowState {
    type: string,
    show: boolean,
}

interface IPluginDockOwner {
    name: string,
    docks: Record<string, {
        config: IPluginDockTab,
    }>,
}

type TPluginDockStorage = Record<string, Record<string, IPluginDockTab>>;

export const updatePluginDockShowStates = (
    states: IPluginDockShowState[],
    plugins: IPluginDockOwner[],
    storage: TPluginDockStorage,
) => {
    let changed = false;
    states.forEach((state) => {
        const plugin = plugins.find((item) => Object.prototype.hasOwnProperty.call(item.docks, state.type));
        if (!plugin) {
            return;
        }
        if (!storage[plugin.name]) {
            storage[plugin.name] = {};
            changed = true;
        }
        if (!storage[plugin.name][state.type]) {
            storage[plugin.name][state.type] = plugin.docks[state.type].config;
            changed = true;
        }
        const config = storage[plugin.name][state.type];
        if (config.show !== state.show) {
            config.show = state.show;
            changed = true;
        }
    });
    return changed;
};
