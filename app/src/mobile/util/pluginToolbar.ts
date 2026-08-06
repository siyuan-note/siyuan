export const getMobilePluginToolbarItems = (toolbar: Array<string | IMenuItem>, builtinTypes: string[]) => {
    const builtinToolbarTypes = new Set(builtinTypes.concat("|"));
    const names = new Set<string>();
    return toolbar.filter((toolbarItem): toolbarItem is IMenuItem => {
        if (typeof toolbarItem === "string" || !toolbarItem.name || builtinToolbarTypes.has(toolbarItem.name) ||
            names.has(toolbarItem.name)) {
            return false;
        }
        names.add(toolbarItem.name);
        return true;
    });
};
