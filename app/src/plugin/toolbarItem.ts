interface IPluginToolbarProvider {
    updateProtyleToolbar(toolbar: Array<string | IMenuItem>): Array<string | IMenuItem>;
}

const pluginToolbarItems = new WeakMap<IPluginToolbarProvider, Map<string, IMenuItem>>();

export const setPluginToolbarItem = (plugin: IPluginToolbarProvider, item: IMenuItem) => {
    let items = pluginToolbarItems.get(plugin);
    if (!items) {
        items = new Map();
        pluginToolbarItems.set(plugin, items);
    }
    items.set(item.name, {...item});
};

export const removePluginToolbarItem = (plugin: IPluginToolbarProvider, name: string) =>
    pluginToolbarItems.get(plugin)?.delete(name) ?? false;

export const clearPluginToolbarItems = (plugin: IPluginToolbarProvider) => {
    pluginToolbarItems.delete(plugin);
};

export const resolvePluginToolbar = (plugin: IPluginToolbarProvider, toolbar: Array<string | IMenuItem>) => {
    const declared = plugin.updateProtyleToolbar(toolbar);
    const registered = pluginToolbarItems.get(plugin);
    if (!registered || registered.size === 0) {
        return declared;
    }
    const registeredNames = new Set(registered.keys());
    return [
        ...declared.filter(item => typeof item === "string" || !registeredNames.has(item.name)),
        ...Array.from(registered.values(), item => ({...item})),
    ];
};
