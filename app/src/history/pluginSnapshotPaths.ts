export type TPluginSnapshotPart = "program" | "data";

export const isPluginSnapshotPath = (path: string, plugin: string, part?: TPluginSnapshotPart) => {
    const name = path.startsWith("/") ? path.substring(1) : path;
    return part === "program" ? name.startsWith(`plugins/${plugin}/`) : part === "data" ?
        name.startsWith(`storage/petal/${plugin}/`) :
        name.startsWith(`plugins/${plugin}/`) || name.startsWith(`storage/petal/${plugin}/`);
};
