const MODIFIER_KEYS = "⌃⌥⇧⌘";
const NON_CHARACTER_KEYS = new Set(["←", "↑", "→", "↓", "⇥", "⌫", "⌦", "↩"]);

export const isDisallowedTextInputHotkey = (hotkey: string) => {
    let mainKeyIndex = 0;
    while (mainKeyIndex < hotkey.length && MODIFIER_KEYS.includes(hotkey[mainKeyIndex])) {
        mainKeyIndex++;
    }
    const modifiers = hotkey.slice(0, mainKeyIndex);
    if (modifiers.includes("⌃") || modifiers.includes("⌥") || modifiers.includes("⌘")) {
        return false;
    }
    const mainKey = hotkey.slice(mainKeyIndex).normalize();
    return Array.from(mainKey).length === 1 && !NON_CHARACTER_KEYS.has(mainKey);
};

export const clearDisallowedTextInputHotkey = (hotkey: string) =>
    isDisallowedTextInputHotkey(hotkey) ? "" : hotkey;

export const normalizePluginHotkey = (hotkey: unknown, customHotkey?: unknown) => {
    const ignoredHotkeys = new Set<string>();
    const sanitizeHotkey = (value: string) => {
        const sanitized = clearDisallowedTextInputHotkey(value);
        if (sanitized !== value) {
            ignoredHotkeys.add(value);
        }
        return sanitized;
    };
    const defaultHotkey = typeof hotkey === "string" ? sanitizeHotkey(hotkey) : "";
    return {
        defaultHotkey,
        customHotkey: typeof customHotkey === "string" ? sanitizeHotkey(customHotkey) : defaultHotkey,
        ignoredHotkeys: Array.from(ignoredHotkeys),
    };
};

export const clearDisallowedKeymapItems = (
    keymap: Record<string, {custom?: unknown; default?: unknown}> | undefined,
    includeDefault = false,
) => {
    let changed = false;
    Object.values(keymap || {}).forEach((item) => {
        if (typeof item.custom === "string") {
            const custom = clearDisallowedTextInputHotkey(item.custom);
            if (custom !== item.custom) {
                item.custom = custom;
                changed = true;
            }
        }
        if (includeDefault && typeof item.default === "string") {
            const defaultHotkey = clearDisallowedTextInputHotkey(item.default);
            if (defaultHotkey !== item.default) {
                item.default = defaultHotkey;
                changed = true;
            }
        }
    });
    return changed;
};
