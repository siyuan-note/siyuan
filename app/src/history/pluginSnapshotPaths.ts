export const isPluginSnapshotPath = (path: string, plugin: string) => {
    const name = path.startsWith("/") ? path.substring(1) : path;
    return name.startsWith(`plugins/${plugin}/`) || name.startsWith(`storage/petal/${plugin}/`);
};
