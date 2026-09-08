import {normalizePluginHotkey} from "../util/hotKeyPolicy";
import {getKeymapBindings, setKeymapBindings} from "../util/keymapBindings";

export const updatePluginKeymap = (pluginName: string, key: string, hotkey: unknown, hotkeys?: string[]) => {
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
    if (keymapItem?.bindings?.version === 1) {
        const keys = getKeymapBindings(keymapItem).map(key => normalizePluginHotkey(key).defaultHotkey).filter(Boolean);
        setKeymapBindings(keymapItem, keys);
    }
    normalized.ignoredHotkeys.forEach((ignoredHotkey) => {
        console.warn(`Plugin ${pluginName} ignored disallowed hotkey "${ignoredHotkey}" for "${key}".`);
    });
    const item = window.siyuan.config.keymap.plugin[pluginName][key];
    if (Array.isArray(hotkeys) && (!item.bindings || item.bindings.version === 1)) {
        const defaults = [...new Set(hotkeys.map(key => normalizePluginHotkey(key).defaultHotkey).filter(Boolean))];
        setKeymapBindings(item, keymapItem ? getKeymapBindings(item) : defaults);
        item.bindings.defaults = defaults;
        item.default = defaults[0] || "";
    }
    return item;
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
    if (keymap[pluginName][key].bindings) {
        setKeymapBindings(keymap[pluginName][key], custom ? [custom] : []);
    }
};
