interface IPluginGlobalShortcutCommand {
    customHotkey?: string;
    globalCallback?: () => void;
}

interface IPluginGlobalShortcutOwner {
    commands: IPluginGlobalShortcutCommand[];
}

export const dispatchPluginGlobalShortcut = (plugins: IPluginGlobalShortcutOwner[], hotkey: string) => {
    for (const plugin of plugins) {
        const command = plugin.commands.find(item => item.globalCallback && item.customHotkey === hotkey);
        if (command) {
            command.globalCallback();
            return true;
        }
    }
    return false;
};
