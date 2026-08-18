interface IPluginDockOwner {
    name: string;
    docks: Record<string, unknown>;
}

interface IDockKeymap {
    general: Config.IKeys;
    plugin?: Config.IKeymapPlugin;
}

export const getDockHotkey = (
    dock: Config.IUILayoutDockTab,
    keymap: IDockKeymap = window.siyuan.config.keymap,
    plugins: IPluginDockOwner[] = window.siyuan.ws.app.plugins,
) => {
    if (dock.hotkeyLangId) {
        return keymap.general[dock.hotkeyLangId]?.custom || "";
    }
    const plugin = plugins.find((item) => Object.prototype.hasOwnProperty.call(item.docks, dock.type));
    if (!plugin) {
        return "";
    }
    return keymap.plugin?.[plugin.name]?.[dock.type]?.custom || "";
};
