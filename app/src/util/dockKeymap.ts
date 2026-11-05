import {getKeymapBindings, getKeymapItem, IShortcutKeymap, normalizeShortcutKey} from "./keymapBindings";

const dockKeys = {fileTree: "1", outline: "2", bookmark: "3", tag: "4", dailyNote: "5", inbox: "6",
    backlinks: "7", graphView: "8", globalGraph: "9", riffCard: "0"};

export const createDockKeymapDefaults = (platform: string): Record<keyof typeof dockKeys, IShortcutKeymap> =>
    Object.fromEntries(Object.entries(dockKeys).map(([key, digit]) => {
        const hotkey = (["darwin", "ios"].includes(platform) ? "⌃" : "⌥") + digit;
        return [key, {default: hotkey, custom: hotkey}];
    })) as Record<keyof typeof dockKeys, IShortcutKeymap>;

export interface SidebarKeymap {
    fileTree: string[];
    outline: string[];
}

export const getSidebarDockOrder = (layout?: Partial<Record<"left" | "right" | "bottom", {
    data?: Array<Array<{hotkeyLangId?: string}>>;
}>>): string[] => (["left", "right", "bottom"] as const).flatMap(side =>
    (layout?.[side]?.data || []).flatMap(section => section.map(dock => dock.hotkeyLangId))
).filter(key => key === "fileTree" || key === "outline");

export const getSidebarKeymap = (keymap: object | undefined, platform: string,
    order: readonly string[] = ["fileTree", "outline"], mac = ["darwin", "ios"].includes(platform)): SidebarKeymap => {
    const defaults = createDockKeymapDefaults(platform);
    const bindings = (key: keyof SidebarKeymap) =>
        getKeymapBindings(keymap && getKeymapItem(keymap, ["general", key]) || defaults[key]);
    const result: SidebarKeymap = {fileTree: [], outline: []};
    const visited = new Set<string>();
    const owned = new Set<string>();
    for (const key of [...order, "fileTree", "outline"]) {
        if ((key !== "fileTree" && key !== "outline") || visited.has(key)) continue;
        visited.add(key);
        result[key] = bindings(key).filter(binding => {
            const normalized = normalizeShortcutKey(binding, mac);
            if (!normalized || owned.has(normalized)) return false;
            owned.add(normalized);
            return true;
        });
    }
    return result;
};

export const readSidebarKeymap = (value: unknown): SidebarKeymap | undefined => {
    if (!value || typeof value !== "object") return;
    const source = value as Record<string, unknown>;
    const result: SidebarKeymap = {fileTree: [], outline: []};
    for (const key of ["fileTree", "outline"] as const) {
        const bindings = source[key];
        if (!Array.isArray(bindings) || bindings.some(binding => typeof binding !== "string")) return;
        result[key] = [...new Set(bindings.filter(Boolean))];
    }
    return result;
};
