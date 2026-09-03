import {normalizePluginHotkey} from "../util/hotKeyPolicy";

export const updatePluginKeymap = (pluginName: string, key: string, hotkey: unknown) => {
    if (!window.siyuan.config.keymap.plugin) {
        window.siyuan.config.keymap.plugin = {};
    }
    if (!window.siyuan.config.keymap.plugin[pluginName]) {
        window.siyuan.config.keymap.plugin[pluginName] = {};
    }
    const keymapItem = window.siyuan.config.keymap.plugin[pluginName][key];
    const normalized = normalizePluginHotkey(hotkey, keymapItem?.custom);
    if (!keymapItem) {
        window.siyuan.config.keymap.plugin[pluginName][key] = {
            default: normalized.defaultHotkey,
            custom: normalized.customHotkey,
        };
    } else {
        keymapItem.default = normalized.defaultHotkey;
        keymapItem.custom = normalized.customHotkey;
    }
    normalized.ignoredHotkeys.forEach((ignoredHotkey) => {
        console.warn(`Plugin ${pluginName} ignored disallowed hotkey "${ignoredHotkey}" for "${key}".`);
    });
    return window.siyuan.config.keymap.plugin[pluginName][key];
};

export const ensurePluginKeymap = (pluginName: string, key: string, hotkey: unknown) => {
    const keymapItem = window.siyuan.config.keymap.plugin?.[pluginName]?.[key];
    if (typeof keymapItem?.default === "string" && typeof keymapItem.custom === "string") {
        return keymapItem;
    }
    return updatePluginKeymap(pluginName, key, hotkey);
};

export const setPluginKeymapCustom = (keymap: Config.IKeymapPlugin, pluginName: string, key: string,
                                      custom: string, defaultHotkey: string) => {
    keymap[pluginName] ??= {};
    keymap[pluginName][key] ??= {
        default: defaultHotkey,
        custom: "",
    };
    keymap[pluginName][key].custom = custom;
};
