export const getProfileEntryVisibility = (profile: Pick<Config.IEntryVisibilityProfile, "entries"> | undefined,
                                           path: string) =>
    typeof profile?.entries[path] === "boolean" ? profile.entries[path] : true;

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
        : defaultOrders;
    return {name: profile.name, entries, orders};
};
