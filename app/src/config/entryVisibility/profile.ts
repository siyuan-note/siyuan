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

// 展开任务状态子菜单，合并重复入口的可见性，并在原菜单位置保留子项顺序及插件位置。
export const migrateTaskStatusMenu = (profile: Pick<Config.IEntryVisibilityProfile, "entries" | "orders">) => {
    const parent = "gutter.single.listBlock";
    const legacy = `${parent}.taskStatus`;
    const defaults = ["taskStatusTodo", "taskStatusInProgress", "taskStatusDone", "taskStatusCanceled", "customTaskStatus"];
    const {entries, orders} = profile;
    const nestedPaths = Object.keys(entries).filter(path => path.startsWith(`${legacy}.`));
    const saved = orders[parent] || [];
    if (!(legacy in entries) && !(legacy in orders) && nestedPaths.length === 0 && !saved.includes("taskStatus")) {
        return;
    }
    const parentVisible = entries[legacy] !== false;
    const customVisible = entries[`${parent}.customTaskStatus`] !== false ||
        (parentVisible && entries[`${legacy}.customTaskStatus`] !== false);
    defaults.forEach(key => {
        entries[`${parent}.${key}`] = key === "customTaskStatus" ? customVisible :
            parentVisible && entries[`${legacy}.${key}`] !== false;
    });
    nestedPaths.forEach(path => {
        const target = `${parent}${path.substring(legacy.length)}`;
        if (!(target in entries)) {
            entries[target] = parentVisible && entries[path];
        }
        delete entries[path];
    });
    delete entries[legacy];
    const children = [...new Set([...(orders[legacy] || []), ...defaults])]
        .filter(key => key !== "taskStatus" && key !== "separator_taskStatus");
    const anchor = saved.includes("taskStatus") ? "taskStatus" : "customTaskStatus";
    const expanded: string[] = [];
    const appendChildren = () => expanded.push(...children, "separator_taskStatus");
    if (!saved.includes(anchor)) {
        appendChildren();
    }
    saved.forEach(key => {
        if (key === anchor) {
            appendChildren();
        } else if (key !== "taskStatus" && key !== "customTaskStatus" && key !== "separator_taskStatus") {
            expanded.push(key);
        }
    });
    orders[parent] = [...new Set(expanded)];
    delete orders[legacy];
};

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
    if (version < 6) {
        migrateTaskStatusMenu({entries, orders});
    }
    return {name: profile.name, entries, orders};
};
