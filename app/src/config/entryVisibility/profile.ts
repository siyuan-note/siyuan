export const getProfileEntryVisibility = (profile: Pick<Config.IEntryVisibilityProfile, "entries"> | undefined,
                                           path: string, defaultVisible = true) =>
    typeof profile?.entries[path] === "boolean" ? profile.entries[path] : defaultVisible;

export const getBuiltinProfileEntryVisibility = (
    profile: "simple" | "full",
    simple: boolean,
    defaultVisible = true,
    simpleDefaultVisible?: boolean,
) => profile === "full"
    ? defaultVisible
    : (simpleDefaultVisible ?? defaultVisible) && simple;

export type TEntryVisibilityImportProfile = {
    name?: unknown;
    base?: unknown;
    entries?: unknown;
    orders?: unknown;
};

export const isEntryVisibilityImportVersionSupported = (version: number, currentVersion: number) =>
    Number.isInteger(version) && version >= 1 && version <= currentVersion;

export const normalizeEntryVisibilityImportProfile = (
    profile: TEntryVisibilityImportProfile,
    version: number,
    defaultOrders: Record<string, string[]>,
): Pick<Config.IEntryVisibilityProfile, "name" | "entries" | "orders"> | undefined => {
    if (!profile || typeof profile.name !== "string" || !profile.name.trim() || !profile.entries ||
        typeof profile.entries !== "object" || Array.isArray(profile.entries) ||
        (version < 3 && profile.base !== "simple" && profile.base !== "full")) {
        return;
    }
    const entries = Object.entries(profile.entries)
        .reduce<Record<string, boolean>>((result, [path, visible]) => {
            if (typeof visible === "boolean") {
                result[path] = visible;
            }
            return result;
        }, {});
    const orders = profile.orders && typeof profile.orders === "object" && !Array.isArray(profile.orders)
        ? Object.entries(profile.orders).reduce<Record<string, string[]>>((result, [path, order]) => {
            if (Array.isArray(order)) {
                result[path] = order.filter((key): key is string => typeof key === "string");
            }
            return result;
        }, {})
        : Object.fromEntries(Object.entries(defaultOrders).map(([path, order]) => [path, [...order]]));
    if (version < 4) {
        if (entries["document.more.editMode.wysiwyg"] === false &&
            entries["document.more.editMode.preview"] === false) {
            entries["document.more.editMode"] = false;
        }
        delete entries["document.more.editMode.wysiwyg"];
        delete entries["document.more.editMode.preview"];
        delete orders["document.more.editMode"];
    }
    if (version < 5) {
        const parent = "gutter.single";
        const children = ["exportCSV", "showDatabaseInFolder"];
        children.forEach((key) => {
            if (typeof entries[`${parent}.${key}`] === "boolean") {
                entries[`${parent}.database.${key}`] = entries[`${parent}.${key}`];
                delete entries[`${parent}.${key}`];
            }
        });
        const order = orders[parent];
        if (order?.some(key => children.includes(key))) {
            orders[`${parent}.database`] = order.filter(key => children.includes(key));
            let inserted = false;
            orders[parent] = order.flatMap((key) => {
                if (!children.includes(key)) {
                    return key === "database" ? [] : [key];
                }
                if (inserted) {
                    return [];
                }
                inserted = true;
                return ["database"];
            });
        }
    }
    return {name: profile.name, entries, orders};
};
