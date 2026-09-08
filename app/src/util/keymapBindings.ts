export interface IShortcutBindings {
    version: 1;
    keys: string[];
    defaults?: string[];
    priority?: Record<string, number>;
}

export const normalizeShortcutKey = (key: string, mac: boolean) => {
    if (mac || !key.startsWith("⌃")) {
        return key;
    }
    if (key === "⌃D") {
        return "";
    }
    return key.replace("⌘", "").replace("⌃", "⌘")
        .replace("⌘⇧", "⇧⌘").replace("⌘⌥⇧", "⌥⇧⌘").replace("⌘⌥", "⌥⌘");
};

export const getDefaultKeymapBindings = (item: IShortcutKeymap): string[] =>
    item.bindings?.version === 1 && Array.isArray(item.bindings.defaults) ?
        [...new Set(item.bindings.defaults.filter(key => typeof key === "string" && key.length > 0))] :
        item.default ? [item.default] : [];

export interface IShortcutKeymap {
    custom: string;
    default?: string;
    bindings?: IShortcutBindings;
}

export const getKeymapBindings = (item?: IShortcutKeymap): string[] => {
    if (!item) {
        return [];
    }
    if (item.bindings) {
        if (item.bindings.version !== 1 || !Array.isArray(item.bindings.keys)) {
            return [];
        }
        return [...new Set(item.bindings.keys.filter(key => typeof key === "string" && key.length > 0))];
    }
    return typeof item.custom === "string" && item.custom ? [item.custom] : [];
};

export const setKeymapBindings = (item: IShortcutKeymap, keys: string[]) => {
    if (item.bindings && item.bindings.version !== 1) {
        throw new Error("Unsupported shortcut binding version");
    }
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const priority = Object.fromEntries(Object.entries(item.bindings?.priority || {})
        .filter(([key]) => uniqueKeys.some(hotkey => key === hotkey || key.endsWith(":" + hotkey))));
    item.bindings = {...item.bindings, version: 1, keys: uniqueKeys, priority};
    item.custom = uniqueKeys[0] || "";
};

export const getKeymapItem = (keymap: object, path: readonly string[]): IShortcutKeymap | undefined => {
    let value: unknown = keymap;
    for (const key of path) {
        if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)) {
            return undefined;
        }
        value = (value as Record<string, unknown>)[key];
    }
    return value && typeof value === "object" && typeof (value as IShortcutKeymap).custom === "string" ?
        value as IShortcutKeymap : undefined;
};

export const visitKeymapItems = (keymap: object, visit: (item: IShortcutKeymap, path: string[]) => void) => {
    const walk = (value: unknown, path: string[]) => {
        if (!value || typeof value !== "object") {
            return;
        }
        if (typeof (value as IShortcutKeymap).custom === "string") {
            visit(value as IShortcutKeymap, path);
            return;
        }
        Object.entries(value).forEach(([key, item]) => walk(item, [...path, key]));
    };
    ["general", "editor", "plugin"].forEach(key => walk((keymap as Record<string, unknown>)[key], [key]));
};

// 默认值更新时保留用户绑定及扩展字段。
export const mergeKeymapDefault = <T extends IShortcutKeymap>(item: T | undefined, template: T): T =>
    item ? {...item, default: template.default} : JSON.parse(JSON.stringify(template));
